/**
 * Animated SVG with SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`).
 *
 * One self-contained file that animates wherever SVG is rendered as a
 * document or `<img>` in modern browsers — no script, no CSS. Click and hover
 * triggers use SMIL event timing.
 */

import { type AnimValue, type CompiledAnimator, type Easing, type PropertyName } from '@svg-motion-studio/core';
import {
  appendChild,
  createElement,
  getAttr,
  prependChild,
  serializeSvg,
  setAttr,
  type SvgElement,
} from '@svg-motion-studio/svg';
import {
  asBezier,
  isTransform,
  num,
  planTrack,
  prepareExport,
  staticOrigin,
  type ExportContext,
  type ExportOptions,
  type ExportResult,
  type NativeEasing,
  type PlanPoint,
} from './plan.js';

/** SMIL `keySplines` only accept control points within [0, 1]. */
export const smilNative: NativeEasing = (ease) => {
  const b = asBezier(ease);
  return b !== undefined && b.every((v) => v >= 0 && v <= 1);
};

/** Reverse a curve for playing a segment backwards (ping-pong). */
function reverseEase(ease: Easing): Easing {
  const b = asBezier(ease) ?? [0, 0, 1, 1];
  return { cubicBezier: [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]] };
}

/** Append the backward pass so that one SMIL iteration is a full there-and-back. */
function mirror(points: readonly PlanPoint[], duration: number): PlanPoint[] {
  const out = [...points];
  for (let j = points.length - 2; j >= 0; j--) {
    out.push({ t: 2 * duration - points[j].t, value: points[j].value, ease: reverseEase(points[j + 1].ease) });
  }
  return out;
}

/** Escape an id for SMIL event timing (`Id-value` with `.` or `-` needs a backslash). */
function smilId(id: string): string {
  return id.replace(/([.\-])/g, '\\$1');
}

const TRANSFORM_ORDER: readonly PropertyName[] = ['translate', 'rotate', 'scale', 'skewX', 'skewY'];
/** True when a transform value leaves the element unchanged. */
function isIdentity(prop: PropertyName, value: unknown): boolean {
  if (prop === 'scale') return Array.isArray(value) && value[0] === 1 && value[1] === 1;
  if (prop === 'translate') return Array.isArray(value) && value[0] === 0 && value[1] === 0;
  return value === 0;
}

/**
 * Export a scene as an animated SVG using SMIL.
 *
 * Throws `SceneError` (invalid scene), `SvgParseError` (bad markup) or
 * `TypeError` (no markup). Everything that cannot be represented exactly is
 * reported in `warnings`.
 */
export function exportSmil(scene: Parameters<typeof prepareExport>[0], options: ExportOptions = {}): ExportResult {
  const ctx = prepareExport(scene, options);
  const s = ctx.compiled.scene;
  const pingPong = s.loop === 'ping-pong';
  const dur = pingPong ? 2 * s.duration : s.duration;
  const repeatCount =
    s.loop === 'once' ? undefined : s.iterations === undefined ? 'indefinite' : num(pingPong ? s.iterations / 2 : s.iterations, 4);
  let defs: SvgElement | undefined;

  const warn = (index: number, field: string, message: string): void => {
    ctx.warnings.push({ severity: 'warning', path: `animators/${index}/${field}`, message });
  };

  const begin = (ca: CompiledAnimator): string => {
    const trigger = ca.animator.trigger ?? { type: 'autoplay' };
    switch (trigger.type) {
      case 'autoplay':
        return `${num(trigger.delay ?? 0)}s`;
      case 'manual':
        return 'indefinite';
      case 'click':
      case 'hover': {
        const event = trigger.type === 'click' ? 'click' : 'mouseover';
        const listen = trigger.target ?? ca.animator.target;
        // The animation element sits inside its target, so a bare event listens on the target itself.
        return listen === ca.animator.target ? event : `${smilId(listen)}.${event}`;
      }
    }
  };

  /** keyTimes / values / keySplines + timing attributes for one planned track. */
  const animation = (ca: CompiledAnimator, format: (v: AnimValue) => string): Record<string, string | undefined> => {
    const planned = planTrack(ca, s.duration, s.fps, smilNative);
    const points = pingPong ? mirror(planned, s.duration) : planned;
    const splines = points.slice(1).map((p) => (asBezier(p.ease) ?? [0, 0, 1, 1]).map((v) => num(v, 4)).join(' '));
    const allLinear = splines.every((sp) => sp === '0 0 1 1');
    return {
      values: points.map((p) => format(p.value)).join(';'),
      keyTimes: points.map((p) => num(p.t / dur, 5)).join(';'),
      calcMode: allLinear ? 'linear' : 'spline',
      keySplines: allLinear ? undefined : splines.join(';'),
      begin: begin(ca),
      dur: `${num(dur)}s`,
      repeatCount,
      fill: 'freeze',
    };
  };

  const startsLater = (ca: CompiledAnimator): boolean => {
    const b = begin(ca);
    return b !== '0s';
  };

  const scalar = (v: AnimValue): string => (typeof v === 'number' ? num(v) : Array.isArray(v) ? v.map((x) => num(x)).join(' ') : String(v));

  // Group the winning animators by element, keeping scene order.
  const groups = new Map<SvgElement, ExportContext['animators'][number][]>();
  for (const item of ctx.animators) {
    const list = groups.get(item.el) ?? [];
    list.push(item);
    groups.set(item.el, list);
  }

  for (const [el, items] of groups) {
    const byProp = new Map(items.map((it) => [it.ca.animator.property, it]));
    const [ox, oy] = staticOrigin(ctx, el);

    const originItem = byProp.get('origin');
    if (originItem !== undefined) {
      const first = JSON.stringify(originItem.ca.track.values[0]);
      if (originItem.ca.track.values.some((v) => JSON.stringify(v) !== first)) {
        warn(originItem.index, 'property', 'SMIL export uses the first origin keyframe only (animated origins need the CSS export)');
      }
    }

    // Transforms: translate · rotate(about origin) · [T(o) · scale · skewX · skewY · T(-o)], all additive.
    const sandwich = (ox !== 0 || oy !== 0) && ['scale', 'skewX', 'skewY'].some((p) => byProp.has(p as PropertyName));
    const staticShift = (x: number, y: number): SvgElement =>
      createElement('animateTransform', {
        attributeName: 'transform',
        type: 'translate',
        values: `${num(x)} ${num(y)}`,
        begin: '0s',
        dur: 'indefinite',
        additive: 'sum',
      });
    let opened = false;
    for (const prop of TRANSFORM_ORDER) {
      const it = byProp.get(prop);
      if (it === undefined) continue;
      if (sandwich && !opened && prop !== 'translate' && prop !== 'rotate') {
        appendChild(el, staticShift(ox, oy));
        opened = true;
      }
      const format =
        prop === 'rotate' ? (v: AnimValue) => `${num(v as number)} ${num(ox)} ${num(oy)}` : scalar;
      const attrs = animation(it.ca, format);
      if (startsLater(it.ca) && !isIdentity(prop, it.ca.track.values[0])) {
        warn(it.index, 'trigger', `before it starts, the SMIL export shows the element's own transform, not the first ${prop} keyframe`);
      }
      appendChild(el, createElement('animateTransform', { attributeName: 'transform', type: prop, ...attrs, additive: 'sum' }));
    }
    if (opened) appendChild(el, staticShift(-ox, -oy));

    for (const it of items) {
      const { animator } = it.ca;
      const prop = animator.property;
      if (isTransform(prop)) continue;

      if (prop === 'motion') {
        const attrs = animation(it.ca, (v) => num(Math.min(1, Math.max(0, v as number)), 4));
        const { values, ...rest } = attrs;
        appendChild(el, createElement('animateMotion', { path: animator.motionPath, keyPoints: values, ...rest }));
        continue;
      }

      let host = el;
      let attributeName: string = prop;
      if (prop === 'blur') {
        const id = `sms-blur-${animator.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        if (defs === undefined) {
          defs = createElement('defs');
          prependChild(ctx.doc.root, defs);
        }
        if (getAttr(el, 'filter') !== undefined) warn(it.index, 'property', 'the element already had a filter; the blur animator replaces it');
        host = createElement('feGaussianBlur', { stdDeviation: num(it.ca.track.values[0] as number) });
        appendChild(defs, createElement('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%' }, [host]));
        setAttr(el, 'filter', `url(#${id})`);
        attributeName = 'stdDeviation';
      }

      const attrs = animation(it.ca, scalar);
      if (startsLater(it.ca)) {
        // Rest on the first keyframe until the animation starts (lower priority: earlier begin).
        appendChild(host, createElement('set', { attributeName, to: attrs.values?.split(';')[0], begin: '0s', fill: 'freeze' }));
      }
      appendChild(host, createElement('animate', { attributeName, ...attrs }));
    }
  }

  return { svg: serializeSvg(ctx.doc), warnings: ctx.warnings };
}

/**
 * Animated SVG with CSS `@keyframes` inside an embedded `<style>`.
 *
 * Uses CSS Animations plus the individual transform properties (`translate`,
 * `rotate`, `scale`), `transform-box: view-box` for SVG user units and the
 * Motion Path properties (`offset-*`). Pure CSS cannot react to clicks, so
 * click and manual triggers are exported paused on their first frame.
 */

import { type AnimValue, type CompiledAnimator, type Easing, type PropertyName } from '@svg-motion-studio/core';
import { createCData, createElement, getAttr, prependChild, serializeSvg, type SvgElement } from '@svg-motion-studio/svg';
import {
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

const CSS_EASINGS: readonly string[] = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'];

/** CSS timing functions cover keywords, any `cubic-bezier()` and single steps. */
export const cssNative: NativeEasing = (ease) => typeof ease !== 'string' || CSS_EASINGS.includes(ease);

/** CSS text of a native easing. */
function cssEase(ease: Easing): string {
  if (typeof ease !== 'string') return `cubic-bezier(${ease.cubicBezier.map((v) => num(v, 4)).join(', ')})`;
  if (ease === 'step-start') return 'steps(1, jump-start)';
  if (ease === 'step-end') return 'steps(1, jump-end)';
  return ease;
}

/** Escape an element id for use in a CSS selector. */
export function cssIdent(id: string): string {
  let out = '';
  Array.from(id).forEach((ch, i) => {
    const ok = /[A-Za-z_\u00A0-\uFFFF]/.test(ch) || (i > 0 && /[0-9-]/.test(ch));
    out += ok ? ch : `\\${(ch.codePointAt(0) ?? 0).toString(16)} `;
  });
  return out;
}

/** How a scene property is written in CSS. */
interface CssProperty {
  /** CSS property name. */
  readonly name: string;
  /** Format one keyframe value. */
  readonly format: (value: AnimValue) => string;
  /** Compatibility caveat, reported as a warning when used. */
  readonly note?: string;
}

const n = (v: AnimValue): string => num(v as number);
const px = (v: AnimValue): string => `${num(v as number)}px`;
const pair = (unit: string) => (v: AnimValue): string => (v as readonly number[]).map((x) => `${num(x)}${unit}`).join(' ');
const color = (v: AnimValue): string => String(v);
const GEOMETRY = 'CSS geometry properties (x, y, width, height, cx, cy, r, rx, ry) need a recent browser; Safari support is partial';

const CSS_PROPERTIES: Readonly<Record<PropertyName, CssProperty | undefined>> = {
  translate: { name: 'translate', format: pair('px') },
  scale: { name: 'scale', format: pair('') },
  rotate: { name: 'rotate', format: (v) => `${n(v)}deg` },
  skewX: { name: 'transform', format: (v) => `skewX(${n(v)}deg)` },
  skewY: { name: 'transform', format: (v) => `skewY(${n(v)}deg)` },
  origin: { name: 'transform-origin', format: pair('px') },
  opacity: { name: 'opacity', format: n },
  fill: { name: 'fill', format: color },
  'fill-opacity': { name: 'fill-opacity', format: n },
  stroke: { name: 'stroke', format: color },
  'stroke-opacity': { name: 'stroke-opacity', format: n },
  'stroke-width': { name: 'stroke-width', format: px },
  'stroke-dashoffset': { name: 'stroke-dashoffset', format: px },
  'stop-color': { name: 'stop-color', format: color },
  offset: undefined, // the CSS `offset` property is the motion-path shorthand, not the stop offset
  blur: { name: 'filter', format: (v) => `blur(${px(v)})` },
  d: { name: 'd', format: (v) => `path("${String(v)}")`, note: 'CSS path morphing (d) is not supported by Safari; use the SMIL export there' },
  motion: { name: 'offset-distance', format: (v) => `${num((v as number) * 100, 3)}%` },
  x: { name: 'x', format: px, note: GEOMETRY },
  y: { name: 'y', format: px, note: GEOMETRY },
  width: { name: 'width', format: px, note: GEOMETRY },
  height: { name: 'height', format: px, note: GEOMETRY },
  cx: { name: 'cx', format: px, note: GEOMETRY },
  cy: { name: 'cy', format: px, note: GEOMETRY },
  r: { name: 'r', format: px, note: GEOMETRY },
  rx: { name: 'rx', format: px, note: GEOMETRY },
  ry: { name: 'ry', format: px, note: GEOMETRY },
};

/** Separate points that share a time (CSS merges equal offsets). */
function spreadJumps(points: readonly PlanPoint[], duration: number): PlanPoint[] {
  const eps = duration * 1e-5;
  const out = points.map((p) => ({ ...p }));
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i - 1].t >= out[i].t) out[i - 1] = { ...out[i - 1], t: out[i].t - eps };
  }
  return out;
}

/**
 * Export a scene as an animated SVG using CSS keyframes.
 *
 * Throws `SceneError` (invalid scene), `SvgParseError` (bad markup) or
 * `TypeError` (no markup). Everything that cannot be represented exactly is
 * reported in `warnings`.
 */
export function exportCss(scene: Parameters<typeof prepareExport>[0], options: ExportOptions = {}): ExportResult {
  const ctx = prepareExport(scene, options);
  const s = ctx.compiled.scene;
  const D = s.duration;
  const count = s.loop === 'once' ? '1' : s.iterations === undefined ? 'infinite' : num(s.iterations, 4);
  const direction = s.loop === 'ping-pong' ? 'alternate' : 'normal';
  const warn = (index: number, field: string, message: string): void => {
    ctx.warnings.push({ severity: 'warning', path: `animators/${index}/${field}`, message });
  };
  const notes = new Set<string>();

  const groups = new Map<SvgElement, ExportContext['animators'][number][]>();
  for (const item of ctx.animators) {
    const list = groups.get(item.el) ?? [];
    list.push(item);
    groups.set(item.el, list);
  }

  const names = new Set<string>();
  const uniqueName = (ca: CompiledAnimator): string => {
    const base = `sms-${ca.animator.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    let name = base;
    for (let k = 2; names.has(name); k++) name = `${base}-${k}`;
    names.add(name);
    return name;
  };

  const blocks: string[] = [];
  for (const [el, items] of groups) {
    const selector = `#${cssIdent(getAttr(el, 'id') ?? '')}`;
    const statics: string[] = [];
    const entries: { text: string; state: 'running' | 'paused'; hover: boolean }[] = [];
    let usesTransformProperty = false;

    if (items.some((it) => isTransform(it.ca.animator.property) || it.ca.animator.property === 'motion')) {
      const [ox, oy] = staticOrigin(ctx, el);
      statics.push('transform-box: view-box', `transform-origin: ${num(ox)}px ${num(oy)}px`);
    }

    for (const it of items) {
      const { animator } = it.ca;
      const prop = CSS_PROPERTIES[animator.property];
      if (prop === undefined) {
        warn(it.index, 'property', `"${animator.property}" cannot be animated with CSS; use the SMIL export`);
        continue;
      }
      if (prop.name === 'transform') {
        if (usesTransformProperty) {
          warn(it.index, 'property', 'CSS export animates only one of skewX / skewY per element; this one is skipped (use the SMIL export)');
          continue;
        }
        usesTransformProperty = true;
        if (getAttr(el, 'transform') !== undefined) {
          warn(it.index, 'property', `${animator.property} overrides the element's transform attribute in CSS; use the SMIL export`);
        }
      }
      if (prop.note !== undefined && !notes.has(prop.note)) {
        notes.add(prop.note);
        warn(it.index, 'property', prop.note);
      }
      if (animator.property === 'origin') {
        const first = JSON.stringify(it.ca.track.values[0]);
        if (it.ca.track.values.every((v) => JSON.stringify(v) === first)) continue; // already in the static transform-origin
      }
      if (animator.property === 'motion') {
        statics.push(`offset-path: path("${animator.motionPath ?? ''}")`, 'offset-rotate: 0deg');
      }

      const points = spreadJumps(planTrack(it.ca, D, s.fps, cssNative), D);
      const name = uniqueName(it.ca);
      const frames = points.map((p, i) => {
        const next = points[i + 1];
        const timing = next !== undefined && next.ease !== 'linear' ? ` animation-timing-function: ${cssEase(next.ease)};` : '';
        return `  ${num((p.t / D) * 100, 4)}% { ${prop.name}: ${prop.format(p.value)};${timing} }`;
      });
      blocks.push(`@keyframes ${name} {\n${frames.join('\n')}\n}`);

      const trigger = animator.trigger ?? { type: 'autoplay' };
      const delay = trigger.type === 'autoplay' ? trigger.delay ?? 0 : 0;
      let state: 'running' | 'paused' = 'running';
      let hover = false;
      if (trigger.type === 'click' || trigger.type === 'manual') {
        state = 'paused';
        warn(it.index, 'trigger', `CSS cannot start an animation on ${trigger.type === 'click' ? 'click' : 'demand'}; it is exported paused on its first frame (use the SMIL export for click)`);
      } else if (trigger.type === 'hover') {
        state = 'paused';
        hover = true;
        if (trigger.target !== undefined && trigger.target !== animator.target) {
          hover = false;
          warn(it.index, 'trigger', 'CSS hover can only listen on the animated element itself; exported paused (use the SMIL export)');
        } else {
          warn(it.index, 'trigger', 'CSS hover pauses and resumes the animation instead of restarting it');
        }
      }
      entries.push({ text: `${name} ${num(D)}s linear ${num(delay)}s ${count} ${direction} both`, state, hover });
    }

    if (entries.length === 0) continue;
    const decls = [...statics, `animation: ${entries.map((e) => e.text).join(', ')}`];
    if (entries.some((e) => e.state === 'paused')) decls.push(`animation-play-state: ${entries.map((e) => e.state).join(', ')}`);
    blocks.push(`${selector} { ${decls.join('; ')}; }`);
    if (entries.some((e) => e.hover)) {
      const states = entries.map((e) => (e.hover ? 'running' : e.state)).join(', ');
      blocks.push(`${selector}:hover { animation-play-state: ${states}; }`);
    }
  }

  if (blocks.length > 0) {
    prependChild(ctx.doc.root, createElement('style', {}, [createCData(`\n${blocks.join('\n')}\n`)]));
  }
  return { svg: serializeSvg(ctx.doc), warnings: ctx.warnings };
}

/**
 * Export planning, shared by every animated-SVG exporter.
 *
 * A keyframe track is turned into a list of points covering the whole scene
 * timeline [0, duration]. Every segment either uses an easing the target
 * format can express natively, or is "baked": sampled on the scene's frame
 * grid into short linear pieces, so the output matches `evaluateScene`.
 */

import {
  compileScene,
  easingFn,
  PROPERTIES,
  round,
  validateScene,
  type AnimValue,
  type CompiledAnimator,
  type CompiledScene,
  type Easing,
  type PropertyName,
  type Scene,
  type SceneIssue,
} from '@svg-motion-studio/core';
import {
  bindScene,
  createElement,
  getAttr,
  parseSvg,
  prependChild,
  readCanvas,
  setAttr,
  type Canvas,
  type SvgDocument,
  type SvgElement,
} from '@svg-motion-studio/svg';

/** One point of a planned track. */
export interface PlanPoint {
  /** Scene time in seconds, within [0, duration]. Equal neighbours mean an instant jump. */
  readonly t: number;
  /** Value at this point, in authoring form (number, vector, color, path). */
  readonly value: AnimValue;
  /** Curve from the previous point to this one (always native to the target). */
  readonly ease: Easing;
}

/** Decides whether an easing can be written natively by the target format. */
export type NativeEasing = (ease: Easing) => boolean;

/** Control points of the CSS keyword curves, as cubic Béziers. */
export const BEZIER_PRESETS: Readonly<Partial<Record<string, readonly [number, number, number, number]>>> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** The easing as a cubic Bézier, when it is one (`linear` included). */
export function asBezier(ease: Easing): readonly [number, number, number, number] | undefined {
  if (typeof ease !== 'string') return ease.cubicBezier;
  if (ease === 'linear') return [0, 0, 1, 1];
  return BEZIER_PRESETS[ease];
}

/**
 * Plan an animator's track over [0, duration] (seconds).
 *
 * - Before the first keyframe and after the last one the value holds.
 * - Keyframes after `duration` are clipped (the clipped segment is baked).
 * - Segments with a non-native easing are baked at `fps`. `step-start` and
 *   `step-end` become instant jumps (two points at the same time) unless the
 *   target supports them natively.
 */
export function planTrack(ca: CompiledAnimator, duration: number, fps: number, native: NativeEasing): PlanPoint[] {
  const { keyframes, values, type } = ca.track;
  const fmt = (raw: unknown): AnimValue => tidy(type.format(raw));
  const n = keyframes.length;

  // The value at t = 0 comes from the last keyframe at or before 0 (or the first one).
  let first = 0;
  while (first + 1 < n && keyframes[first + 1].t <= 0) first++;
  const points: PlanPoint[] = [{ t: 0, value: fmt(values[first]), ease: 'linear' }];
  if (keyframes[first].t > 0 && keyframes[first].t < duration) {
    points.push({ t: keyframes[first].t, value: fmt(values[first]), ease: 'linear' }); // hold
  }

  for (let i = first + 1; i < n; i++) {
    const t0 = keyframes[i - 1].t;
    if (t0 >= duration) break;
    const kf = keyframes[i];
    const ease: Easing = kf.ease ?? 'linear';
    const clipped = kf.t > duration;

    if (!clipped && native(ease)) {
      points.push({ t: kf.t, value: fmt(values[i]), ease });
    } else if (!clipped && (ease === 'step-end' || ease === 'step-start')) {
      // Instant jump: two points at the same time.
      const before = ease === 'step-end' ? values[i - 1] : values[i];
      points.push({ t: ease === 'step-end' ? kf.t : t0, value: fmt(before), ease: 'linear' });
      points.push({ t: kf.t, value: fmt(values[i]), ease: 'linear' });
    } else if (kf.t > t0) {
      // Bake: sample the eased segment on the frame grid, clipped at `duration`.
      const curve = easingFn(ease);
      const span = kf.t - t0;
      const t1 = Math.min(kf.t, duration);
      const steps = Math.max(2, Math.ceil((t1 - t0) * fps));
      for (let k = 1; k <= steps; k++) {
        const t = t0 + ((t1 - t0) * k) / steps;
        points.push({ t, value: fmt(type.lerp(values[i - 1], values[i], curve((t - t0) / span))), ease: 'linear' });
      }
    } else {
      points.push({ t: kf.t, value: fmt(values[i]), ease: 'linear' }); // same time: jump
    }
  }

  const last = points[points.length - 1];
  if (last.t < duration) points.push({ t: duration, value: last.value, ease: 'linear' });
  return points;
}

/** Round numbers (and vector components) for compact, deterministic output. */
export function tidy(value: AnimValue): AnimValue {
  if (typeof value === 'number') return round(value, 3);
  if (typeof value === 'string') return value;
  return value.map((v) => round(v, 3));
}

/** Format a number for markup: rounded, no `-0`, no exponent for normal ranges. */
export function num(value: number, decimals = 3): string {
  return String(round(value, decimals));
}

/** Options shared by the exporters. */
export interface ExportOptions {
  /** SVG markup to animate. Defaults to `scene.source`. */
  readonly source?: string;
}

/** Output of an exporter. */
export interface ExportResult {
  /** The animated, self-contained SVG document. */
  readonly svg: string;
  /** Things the export could not represent exactly, plus scene warnings. */
  readonly warnings: readonly SceneIssue[];
}

/** Everything an emitter needs: the document, the winning animators and their elements. */
export interface ExportContext {
  /** Parsed copy of the source markup (safe to mutate). */
  readonly doc: SvgDocument;
  /** Canvas of the document. */
  readonly canvas: Canvas;
  /** The compiled scene. */
  readonly compiled: CompiledScene;
  /** Enabled animators with a bound element; for repeated target+property only the last. */
  readonly animators: readonly { readonly ca: CompiledAnimator; readonly el: SvgElement; readonly index: number }[];
  /** Collected warnings; emitters append to it. */
  readonly warnings: SceneIssue[];
}

/**
 * Validate + compile the scene, parse its markup, bind animators to elements
 * and prepare the document (namespace, background). Throws `SceneError` for
 * an invalid scene, `SvgParseError` for bad markup and `TypeError` when there
 * is no markup.
 */
export function prepareExport(scene: Scene, options: ExportOptions = {}): ExportContext {
  const compiled = compileScene(scene);
  const markup = options.source ?? scene.source;
  if (typeof markup !== 'string') throw new TypeError('no SVG markup: pass options.source or set scene.source');
  const doc = parseSvg(markup);
  const canvas = readCanvas(doc);
  const binding = bindScene(doc, scene);
  const warnings: SceneIssue[] = [...validateScene(scene), ...binding.issues];

  if (getAttr(doc.root, 'xmlns') === undefined) setAttr(doc.root, 'xmlns', 'http://www.w3.org/2000/svg');
  if (scene.background !== undefined) {
    const [x, y, w, h] = canvas.viewBox;
    prependChild(doc.root, createElement('rect', { x, y, width: w, height: h, fill: scene.background }));
  }

  // Later animators win on the same element property, like evaluateScene.
  const winners = new Map<string, { ca: CompiledAnimator; el: SvgElement; index: number }>();
  compiled.animators.forEach((ca) => {
    const el = binding.elements.get(ca.animator.id);
    if (el === undefined) return;
    const index = scene.animators.indexOf(ca.animator);
    const key = `${ca.animator.target}\u0000${ca.animator.property}`;
    winners.delete(key); // re-insert so order follows the winner
    winners.set(key, { ca, el, index });
  });
  return { doc, canvas, compiled, animators: [...winners.values()], warnings };
}

/** True for properties that are composed into the element transform. */
export function isTransform(property: PropertyName): boolean {
  return PROPERTIES[property].group === 'transform';
}

/** The static origin `[x, y]` for an element: first value of its `origin` animator, else `[0, 0]`. */
export function staticOrigin(ctx: ExportContext, el: SvgElement): readonly [number, number] {
  const origin = ctx.animators.find((a) => a.el === el && a.ca.animator.property === 'origin');
  const v = origin?.ca.track.values[0];
  return Array.isArray(v) ? [v[0], v[1]] : [0, 0];
}

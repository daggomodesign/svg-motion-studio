/**
 * @svg-motion-studio/core — engine kernel.
 *
 * Pure time-evaluation for keyframed properties: easing curves, interpolation
 * and track sampling. No DOM, no Node-specific APIs — this module runs in
 * browsers, Node.js and Termux alike.
 *
 * Milestone 1 seed. Everything else in the studio (SVG pipeline, exporters,
 * editor, CLI, MCP) builds on top of `compileTrack` + `sampleCompiled`.
 */

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** A single point of an animated property. */
export interface Keyframe {
  /** Time in seconds, relative to the start of the track. */
  readonly t: number;
  /** Value at this keyframe. */
  readonly value: number;
  /**
   * Curve used to travel from the PREVIOUS keyframe to this one.
   * Defaults to `'linear'`. CSS-like semantics: easing lives on the keyframe
   * the segment arrives at.
   */
  readonly ease?: Easing;
}

/** A track is a list of keyframes; order is normalized by {@link compileTrack}. */
export type Track = readonly Keyframe[];

/** A named easing curve, or an explicit cubic Bézier (CSS `cubic-bezier()` semantics). */
export type Easing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-quad'
  | 'ease-out-quad'
  | 'ease-in-out-quad'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-in-out-cubic'
  | 'ease-in-back'
  | 'ease-out-back'
  | 'ease-in-out-back'
  | 'bounce-out'
  | 'elastic-out'
  | 'step-start'
  | 'step-end'
  | { readonly cubicBezier: readonly [number, number, number, number] };

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/** A normalized easing function: maps x ∈ [0, 1] → y with f(0) = 0 and f(1) = 1. */
export type EasingFn = (x: number) => number;

const K = 1.70158; // back-overshoot constant
const K2 = K * 1.525; // back-overshoot constant (in-out variant)
const K3 = K + 1;
const TAU_3 = (2 * Math.PI) / 3;

function bounceOut(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

function elasticOut(x: number): number {
  if (x === 0 || x === 1) return x;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * TAU_3) + 1;
}

/**
 * Build an easing function from a cubic Bézier with control points
 * `(x1, y1)` and `(x2, y2)` — the same semantics as CSS `cubic-bezier()`.
 * Solves `x(t) = target` with Newton–Raphson and a bisection fallback.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  if (x1 === y1 && x2 === y2) return (x) => x; // degenerate → linear

  const pointX = (t: number): number =>
    ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
  const pointY = (t: number): number =>
    ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
  const dPointX = (t: number): number =>
    3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = dPointX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (pointX(t) - x) / d;
    }
    if (t < 0 || t > 1) {
      // Newton diverged on a flat segment — bisect instead.
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 24; i++) {
        const px = pointX(t);
        if (Math.abs(px - x) < 1e-6) break;
        if (px < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return t;
  };

  return (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : pointY(solveT(x)));
}

const NAMED: Readonly<Record<string, EasingFn>> = {
  linear: (x) => x,
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
  'ease-in-quad': (x) => x * x,
  'ease-out-quad': (x) => 1 - (1 - x) * (1 - x),
  'ease-in-out-quad': (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  'ease-in-cubic': (x) => x * x * x,
  'ease-out-cubic': (x) => 1 - Math.pow(1 - x, 3),
  'ease-in-out-cubic': (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  'ease-in-back': (x) => K3 * x * x * x - K * x * x,
  'ease-out-back': (x) => 1 + K3 * Math.pow(x - 1, 3) + K * Math.pow(x - 1, 2),
  'ease-in-out-back': (x) =>
    x < 0.5
      ? (Math.pow(2 * x, 2) * ((K2 + 1) * 2 * x - K2)) / 2
      : (Math.pow(2 * x - 2, 2) * ((K2 + 1) * (x * 2 - 2) + K2) + 2) / 2,
  'bounce-out': bounceOut,
  'elastic-out': elasticOut,
  'step-start': () => 1,
  'step-end': (x) => (x >= 1 ? 1 : 0),
};

/**
 * Resolve an {@link Easing} descriptor into a callable curve.
 * Unknown names fall back to linear.
 */
export function easingFn(ease: Easing = 'linear'): EasingFn {
  if (typeof ease === 'string') return NAMED[ease] ?? NAMED.linear;
  const [x1, y1, x2, y2] = ease.cubicBezier;
  return cubicBezier(x1, y1, x2, y2);
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Linear interpolation between `a` and `b` at fraction `t` (not clamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A track prepared for fast repeated sampling. */
export interface CompiledTrack {
  /** Keyframes sorted by ascending time. */
  readonly keyframes: readonly Keyframe[];
  /** Time of the first keyframe (seconds). */
  readonly start: number;
  /** Time of the last keyframe (seconds). */
  readonly end: number;
  /** `end - start` (seconds). */
  readonly duration: number;
}

/**
 * Normalize a track for sampling: returns the keyframes sorted by time plus
 * precomputed bounds. Call once (e.g. when a scene loads or an export starts),
 * then use {@link sampleCompiled} on every frame.
 */
export function compileTrack(track: Track): CompiledTrack {
  const keyframes = [...track].sort((a, b) => a.t - b.t);
  const start = keyframes.length > 0 ? keyframes[0].t : 0;
  const end = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 0;
  return { keyframes, start, end, duration: end - start };
}

/**
 * Evaluate a compiled track at `time` (seconds, same axis as keyframe times).
 *
 * - Times before the first keyframe clamp to the first value; times after the
 *   last keyframe clamp to the last value.
 * - A single-keyframe track is constant; an empty track yields `0`.
 * - Each segment is interpolated with the easing of the keyframe it arrives at.
 */
export function sampleCompiled(ct: CompiledTrack, time: number): number {
  const kfs = ct.keyframes;
  if (kfs.length === 0) return 0;
  if (kfs.length === 1) return kfs[0].value;
  if (time <= kfs[0].t) return kfs[0].value;
  if (time >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].value;

  // Binary-search the segment [lo, hi] that contains `time`.
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= time) lo = mid;
    else hi = mid;
  }
  const from = kfs[lo];
  const to = kfs[hi];
  const span = to.t - from.t;
  const x = span <= 0 ? 1 : (time - from.t) / span;
  return lerp(from.value, to.value, easingFn(to.ease)(x));
}

/** Convenience one-shot: compile + sample. Prefer {@link sampleCompiled} in hot paths. */
export function sampleTrack(track: Track, time: number): number {
  return sampleCompiled(compileTrack(track), time);
}

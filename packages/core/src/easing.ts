/**
 * Easing curves.
 *
 * Every curve is a normalized function x ∈ [0, 1] → y with f(1) = 1 and
 * f(0) = 0 (except `step-start`, which follows CSS and is 1 everywhere).
 * "Back" and "elastic" curves may overshoot outside [0, 1] between the
 * endpoints; value types are responsible for clamping where it matters
 * (e.g. color channels).
 */

/** Names of the built-in easing presets. */
export const EASING_NAMES = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-quad',
  'ease-out-quad',
  'ease-in-out-quad',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-in-out-cubic',
  'ease-in-back',
  'ease-out-back',
  'ease-in-out-back',
  'bounce-out',
  'elastic-out',
  'step-start',
  'step-end',
] as const;

/** A built-in easing preset name. */
export type EasingName = (typeof EASING_NAMES)[number];

/** A named easing curve, or an explicit cubic Bézier (CSS `cubic-bezier()` semantics). */
export type Easing = EasingName | { readonly cubicBezier: readonly [number, number, number, number] };

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
 *
 * Throws a `RangeError` when `x1` or `x2` lies outside [0, 1] (the curve would
 * not be a function of time), matching the CSS rule.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) {
    throw new RangeError(`cubic-bezier x values must be within [0, 1], got ${x1}, ${x2}`);
  }
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
      const err = pointX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = dPointX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Newton did not converge (flat segment) — bisect, which always converges
    // because x(t) is monotonic for x1, x2 ∈ [0, 1].
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const px = pointX(t);
      if (Math.abs(px - x) < 1e-7) break;
      if (px < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : pointY(solveT(x)));
}

const NAMED: Readonly<Record<EasingName, EasingFn>> = {
  linear: (x) => x,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
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
  // CSS `steps(1, jump-start)`: jumps to the end value as soon as the segment starts.
  'step-start': () => 1,
  'step-end': (x) => (x >= 1 ? 1 : 0),
};

/** True when `value` is a valid {@link Easing} descriptor. */
export function isEasing(value: unknown): value is Easing {
  if (typeof value === 'string') return (EASING_NAMES as readonly string[]).includes(value);
  if (typeof value !== 'object' || value === null) return false;
  const cb = (value as { cubicBezier?: unknown }).cubicBezier;
  return (
    Array.isArray(cb) &&
    cb.length === 4 &&
    cb.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    cb[0] >= 0 &&
    cb[0] <= 1 &&
    cb[2] >= 0 &&
    cb[2] <= 1
  );
}

/**
 * Resolve an {@link Easing} descriptor into a callable curve.
 * Unknown names fall back to linear (use {@link isEasing} to validate input).
 */
export function easingFn(ease: Easing = 'linear'): EasingFn {
  if (typeof ease === 'string') return NAMED[ease] ?? NAMED.linear;
  const [x1, y1, x2, y2] = ease.cubicBezier;
  return cubicBezier(x1, y1, x2, y2);
}

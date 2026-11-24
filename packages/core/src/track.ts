/**
 * Keyframe tracks: compile once, sample many times.
 */

import { easingFn, type Easing, type EasingFn } from './easing.js';
import { numberType, type ValueType } from './values.js';

/** A single point of an animated property. */
export interface Keyframe<V = number> {
  /** Time in seconds, relative to the start of the track. */
  readonly t: number;
  /** Value at this keyframe. */
  readonly value: V;
  /**
   * Curve used to travel from the PREVIOUS keyframe to this one.
   * Defaults to `'linear'`. CSS-like semantics: easing lives on the keyframe
   * the segment arrives at.
   */
  readonly ease?: Easing;
}

/** A track is a list of keyframes; order is normalized by {@link compileTrack}. */
export type Track<V = number> = readonly Keyframe<V>[];

/** A track prepared for fast repeated sampling. */
export interface CompiledTrack<V = number, R = V> {
  /** Keyframes sorted by ascending time (stable for equal times). */
  readonly keyframes: readonly Keyframe<V>[];
  /** Parsed values, parallel to {@link CompiledTrack.keyframes}. */
  readonly values: readonly R[];
  /** Resolved easing curves, parallel to {@link CompiledTrack.keyframes}. */
  readonly eases: readonly EasingFn[];
  /** Value type used to interpolate and format. */
  readonly type: ValueType<V, R>;
  /** Time of the first keyframe (seconds). */
  readonly start: number;
  /** Time of the last keyframe (seconds). */
  readonly end: number;
  /** `end - start` (seconds). */
  readonly duration: number;
}

/**
 * Prepare a track for sampling: sorts keyframes by time, parses every value
 * and resolves every easing curve, so that {@link sampleCompiled} does no
 * allocation-heavy work per frame. Call once (when a scene loads or an export
 * starts).
 *
 * Throws `TypeError` when a value cannot be parsed or when two neighbouring
 * values are structurally incompatible (e.g. paths with different commands),
 * and `RangeError` for invalid keyframe times.
 */
export function compileTrack<V = number, R = V>(
  track: Track<V>,
  type: ValueType<V, R> = numberType as unknown as ValueType<V, R>,
): CompiledTrack<V, R> {
  for (const kf of track) {
    if (typeof kf.t !== 'number' || !Number.isFinite(kf.t)) {
      throw new RangeError(`keyframe time must be a finite number, got ${String(kf.t)}`);
    }
  }
  const keyframes = [...track].sort((a, b) => a.t - b.t);
  const values = keyframes.map((kf) => type.parse(kf.value));
  const eases = keyframes.map((kf) => easingFn(kf.ease));

  if (type.compatible) {
    for (let i = 1; i < values.length; i++) {
      if (!type.compatible(values[i - 1], values[i])) {
        throw new TypeError(
          `${type.name} keyframes at t=${keyframes[i - 1].t} and t=${keyframes[i].t} are not compatible`,
        );
      }
    }
  }

  const start = keyframes.length > 0 ? keyframes[0].t : 0;
  const end = keyframes.length > 0 ? keyframes[keyframes.length - 1].t : 0;
  return { keyframes, values, eases, type, start, end, duration: end - start };
}

/**
 * Evaluate a compiled track at `time` and return the parsed (internal) value.
 * Returns `undefined` for an empty track.
 *
 * - Times before the first keyframe clamp to the first value; times after the
 *   last keyframe clamp to the last value.
 * - Each segment is interpolated with the easing of the keyframe it arrives at.
 * - Segment lookup is a binary search: O(log n) per call.
 */
export function sampleRaw<V, R>(ct: CompiledTrack<V, R>, time: number): R | undefined {
  const kfs = ct.keyframes;
  const n = kfs.length;
  if (n === 0) return undefined;
  if (n === 1 || time <= kfs[0].t) return ct.values[0];
  if (time >= kfs[n - 1].t) return ct.values[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= time) lo = mid;
    else hi = mid;
  }
  const span = kfs[hi].t - kfs[lo].t;
  const x = span <= 0 ? 1 : (time - kfs[lo].t) / span;
  return ct.type.lerp(ct.values[lo], ct.values[hi], ct.eases[hi](x));
}

/**
 * Evaluate a compiled track at `time` (seconds, same axis as keyframe times)
 * and return an authoring value (number, color string, path string…).
 * An empty number track yields `0`; other empty tracks yield `undefined`.
 */
export function sampleCompiled<V, R>(ct: CompiledTrack<V, R>, time: number): V {
  const raw = sampleRaw(ct, time);
  if (raw === undefined) return (ct.type.name === 'number' ? 0 : undefined) as V;
  return ct.type.format(raw);
}

/** Convenience one-shot: compile + sample. Prefer {@link sampleCompiled} in hot paths. */
export function sampleTrack<V = number, R = V>(
  track: Track<V>,
  time: number,
  type?: ValueType<V, R>,
): V {
  return sampleCompiled(compileTrack(track, type), time);
}

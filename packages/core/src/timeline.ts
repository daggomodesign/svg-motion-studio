/**
 * Timeline math: looping, frame grids and time formatting.
 * Pure functions of numbers — no clocks, no timers.
 */

/** How a timeline repeats once it reaches its duration. */
export type LoopMode = 'once' | 'loop' | 'ping-pong';

/** Playback settings needed to map elapsed time onto the timeline. */
export interface Playback {
  /** Timeline length in seconds. */
  readonly duration: number;
  /** Repeat behaviour. */
  readonly loop: LoopMode;
  /**
   * Number of passes for `loop` / `ping-pong` (each direction counts as one
   * pass in ping-pong). Defaults to `Infinity`. Ignored for `once`.
   */
  readonly iterations?: number;
}

/**
 * Map elapsed playback time (seconds since the timeline started) onto a
 * position on the timeline, in [0, duration].
 *
 * Before the start the timeline rests at 0; after the last iteration it holds
 * the position where the last pass ended.
 */
export function localTime(elapsed: number, playback: Playback): number {
  const d = playback.duration;
  if (!(d > 0) || !(elapsed > 0)) return 0;
  if (playback.loop === 'once') return Math.min(elapsed, d);

  const n = playback.iterations ?? Infinity;
  if (!(n > 0)) return 0;
  const pass = Math.floor(elapsed / d);
  if (pass >= n) {
    // Finished: hold the end of the last pass.
    const lastPass = Math.ceil(n) - 1;
    return playback.loop === 'ping-pong' && lastPass % 2 === 1 ? 0 : d;
  }
  const t = elapsed - pass * d;
  return playback.loop === 'ping-pong' && pass % 2 === 1 ? d - t : t;
}

/** Total playback length in seconds (`Infinity` for endless loops). */
export function totalLength(playback: Playback): number {
  if (playback.loop === 'once') return Math.max(0, playback.duration);
  return Math.max(0, playback.duration) * (playback.iterations ?? Infinity);
}

/** Snap a time to the nearest frame boundary of a `fps` grid. */
export function snapToFrame(time: number, fps: number): number {
  if (!(fps > 0)) throw new RangeError(`fps must be > 0, got ${fps}`);
  return Math.round(time * fps) / fps;
}

/**
 * Number of frames needed to render `duration` seconds at `fps`.
 * The end instant is excluded so looping renders do not duplicate a frame.
 */
export function frameCount(duration: number, fps: number): number {
  if (!(fps > 0)) throw new RangeError(`fps must be > 0, got ${fps}`);
  if (!(duration > 0)) return 0;
  return Math.max(1, Math.round(duration * fps));
}

/**
 * Times (seconds) of every frame for rendering `duration` seconds at `fps`.
 * Pass `includeEnd: true` to append the exact end instant (useful for
 * non-looping exports that must land on the final pose).
 */
export function frameTimes(duration: number, fps: number, includeEnd = false): number[] {
  const n = frameCount(duration, fps);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i / fps;
  if (includeEnd && duration > 0) out.push(duration);
  return out;
}

/** Format seconds as `mm:ss.mmm` (e.g. `01:02.500`) for timeline rulers. */
export function formatTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

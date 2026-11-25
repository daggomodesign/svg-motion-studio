/**
 * Auto-animate: a sensible animation for a drawing nobody has animated yet.
 *
 * The point is to make the first second of the editor feel alive — you import
 * a drawing and it already moves, in a way that reads as intentional rather
 * than random. Elements enter in reading order, then settle into a slow idle.
 */

import type { Animator, Scene } from '@svg-motion-studio/core';
import { getPreset } from './index.js';

/** Options for {@link autoAnimate}. */
export interface AutoAnimateOptions {
  /** Seconds between one element's entrance and the next. Defaults to 0.12. */
  readonly stagger?: number;
  /** Entrance preset id. Defaults to `fade-in`. */
  readonly entrance?: string;
  /** Idle preset id, or `none` to skip it. Defaults to `float`. */
  readonly idle?: string;
  /** Rotation / scale origin per element id. */
  readonly origins?: Readonly<Record<string, readonly [number, number]>>;
  /** Cap on how many elements get an entrance. Defaults to 24. */
  readonly limit?: number;
}

/**
 * Build a scene animation for `elementIds`, in the order given.
 *
 * Returns the animators only — the caller decides which scene they belong to,
 * so this works for a fresh import and for "reset the animation" in the editor.
 */
export function autoAnimate(elementIds: readonly string[], options: AutoAnimateOptions = {}): Animator[] {
  const stagger = options.stagger ?? 0.12;
  const entrance = getPreset(options.entrance ?? 'fade-in');
  const idle = options.idle === 'none' ? undefined : getPreset(options.idle ?? 'float');
  const limit = options.limit ?? 24;

  const animators: Animator[] = [];
  const targets = elementIds.slice(0, limit);

  targets.forEach((target, i) => {
    const origin = options.origins?.[target];
    if (entrance !== undefined) {
      animators.push(
        ...entrance.build(target, {
          delay: i * stagger,
          origin,
          idPrefix: `in${i}`,
        }),
      );
    }
    if (idle !== undefined) {
      animators.push(
        ...idle.build(target, {
          delay: i * stagger + 0.4,
          origin,
          idPrefix: `idle${i}`,
        }),
      );
    }
  });

  return animators;
}

/**
 * Apply auto-animation to a scene, returning a new scene.
 * The scene's duration is extended so the staggered entrances fit.
 */
export function withAutoAnimate(scene: Scene, elementIds: readonly string[], options: AutoAnimateOptions = {}): Scene {
  const animators = autoAnimate(elementIds, options);
  const stagger = options.stagger ?? 0.12;
  const needed = Math.min(elementIds.length, options.limit ?? 24) * stagger + 2.4;
  return {
    ...scene,
    duration: Math.max(scene.duration, Math.ceil(needed * 2) / 2),
    animators,
  };
}

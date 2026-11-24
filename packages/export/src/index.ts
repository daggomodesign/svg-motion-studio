/**
 * @svg-motion-studio/export — exporters.
 *
 * Turn a scene plus its SVG markup into a self-contained animated SVG, with
 * SMIL elements or CSS keyframes. Pure TypeScript: the result is a string,
 * so writing it to disk is up to the surface (CLI, editor, MCP).
 */

import type { Scene } from '@svg-motion-studio/core';
import { exportCss } from './css.js';
import type { ExportOptions, ExportResult } from './plan.js';
import { exportSmil } from './smil.js';

export * from './plan.js';
export * from './smil.js';
export * from './css.js';

/** Animated-SVG flavours. */
export type AnimatedSvgFormat = 'smil' | 'css';

/** Export a scene as an animated SVG in the given flavour. */
export function exportAnimatedSvg(scene: Scene, format: AnimatedSvgFormat, options: ExportOptions = {}): ExportResult {
  return format === 'css' ? exportCss(scene, options) : exportSmil(scene, options);
}

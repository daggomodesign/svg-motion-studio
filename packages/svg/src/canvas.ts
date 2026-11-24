/**
 * Canvas geometry of an SVG document, and scene creation from markup.
 */

import { createScene, type Scene } from '@svg-motion-studio/core';
import { getAttr } from './dom.js';
import { parseSvg, type SvgDocument } from './xml.js';

/** Size and coordinate system of the root `<svg>`. */
export interface Canvas {
  /** Width in user units (from the viewBox when present). */
  readonly width: number;
  /** Height in user units (from the viewBox when present). */
  readonly height: number;
  /** `[minX, minY, width, height]` of the user coordinate system. */
  readonly viewBox: readonly [number, number, number, number];
}

const DEFAULT_WIDTH = 300; // SVG default size of a replaced element
const DEFAULT_HEIGHT = 150;

function length(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^\s*([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*(px)?\s*$/.exec(value);
  if (m === null) return undefined; // %, em… cannot be resolved without a viewport
  const v = Number(m[1]);
  return v > 0 ? v : undefined;
}

/**
 * Read the canvas of a document: the `viewBox` when valid, otherwise the
 * numeric `width` / `height` attributes, otherwise the SVG default 300×150.
 */
export function readCanvas(doc: SvgDocument): Canvas {
  const w = length(getAttr(doc.root, 'width'));
  const h = length(getAttr(doc.root, 'height'));
  const vb = (getAttr(doc.root, 'viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    return { width: vb[2], height: vb[3], viewBox: [vb[0], vb[1], vb[2], vb[3]] };
  }
  const width = w ?? DEFAULT_WIDTH;
  const height = h ?? DEFAULT_HEIGHT;
  return { width, height, viewBox: [0, 0, width, height] };
}

/**
 * Start a scene from SVG markup: the canvas size comes from the document and
 * the markup becomes `scene.source`. Throws `SvgParseError` for bad markup.
 */
export function sceneFromSvg(markup: string, overrides: Partial<Omit<Scene, 'version' | 'source'>> = {}): Scene {
  const { width, height } = readCanvas(parseSvg(markup));
  return createScene({ width, height, ...overrides, source: markup });
}

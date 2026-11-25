/**
 * The import pipeline: one call that turns a drawing tool's SVG export into a
 * clean, animatable document plus a report of what was changed.
 *
 * The steps are deliberately separate functions so the CLI, the editor and the
 * MCP server can run them individually, but {@link importSvg} is the normal
 * entry point.
 */

import { createScene, type Scene } from '@svg-motion-studio/core';
import { parseSvg, serializeSvg, type SvgDocument } from '@svg-motion-studio/svg';
import { inlineStyles, type InlineResult } from './css.js';
import {
  normalizeCanvas,
  normalizeReferences,
  pruneEmptyDefs,
  stripEditorMetadata,
} from './normalize.js';
import { assignIds, detectLayers, type Layer } from './structure.js';

/** The drawing tool an export came from. */
export type SourceTool = 'coreldraw' | 'inkscape' | 'illustrator' | 'figma' | 'unknown';

/** One thing the import changed or could not handle. */
export interface ImportNote {
  /** `info` is a change, `warning` needs a look, `error` blocks animation. */
  readonly severity: 'info' | 'warning' | 'error';
  /** Which step produced it. */
  readonly step: string;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Options for {@link importSvg}. */
export interface ImportOptions {
  /** Force the source tool instead of detecting it. */
  readonly tool?: SourceTool;
  /** Prefix for generated ids. Defaults to `el`. */
  readonly idPrefix?: string;
  /** Flatten `<style>` and `style="…"` into attributes. Defaults to `true`. */
  readonly inlineCss?: boolean;
  /** Remove editor metadata. Defaults to `true`. */
  readonly stripMetadata?: boolean;
  /** Rewrite `xlink:href` as `href`. Defaults to `true`. */
  readonly modernizeRefs?: boolean;
  /** Make `width` / `height` agree with the `viewBox`. Defaults to `true`. */
  readonly normalizeCanvas?: boolean;
  /** Give every animatable element a stable id. Defaults to `true`. */
  readonly assignIds?: boolean;
  /** Scene settings to apply on top of the detected canvas. */
  readonly scene?: Partial<Omit<Scene, 'version' | 'source'>>;
}

/** Everything {@link importSvg} produced. */
export interface ImportResult {
  /** The cleaned document. */
  readonly doc: SvgDocument;
  /** The cleaned markup, ready to become `scene.source`. */
  readonly svg: string;
  /** A scene pointing at that markup, with the detected canvas. */
  readonly scene: Scene;
  /** Detected (or forced) source tool. */
  readonly tool: SourceTool;
  /** Canvas size in user units. */
  readonly width: number;
  /** Canvas height in user units. */
  readonly height: number;
  /** Layers found in the document. */
  readonly layers: readonly Layer[];
  /** Ids of every animatable element, in document order. */
  readonly elementIds: readonly string[];
  /** What changed, and what needs attention. */
  readonly notes: readonly ImportNote[];
}

/**
 * Guess which tool produced the markup, from the namespaces and the id style
 * each one leaves behind.
 */
export function detectTool(markup: string): SourceTool {
  if (/xmlns:inkscape|inkscape:version|sodipodi:/.test(markup)) return 'inkscape';
  if (/xmlns:corel|corel:/.test(markup) || /\bid="(?:Layer|Curve|Text|Bitmap)_x[0-9A-Fa-f]{4}_/.test(markup)) return 'coreldraw';
  if (/<\?xml-stylesheet[^>]*illustrator|xmlns:x="&ns_extend;"|id="Layer_1"/.test(markup)) return 'illustrator';
  if (/data-figma|figma\.com/.test(markup)) return 'figma';
  return 'unknown';
}

/** Human label for a tool. */
export const TOOL_LABELS: Readonly<Record<SourceTool, string>> = {
  coreldraw: 'CorelDRAW',
  inkscape: 'Inkscape',
  illustrator: 'Adobe Illustrator',
  figma: 'Figma',
  unknown: 'unknown tool',
};

/**
 * Import SVG markup from a drawing tool.
 *
 * Throws `SvgParseError` when the markup is not a well-formed SVG document.
 * Everything else — including problems that only affect animation — comes back
 * in `notes`.
 */
export function importSvg(markup: string, options: ImportOptions = {}): ImportResult {
  const notes: ImportNote[] = [];
  const note = (severity: ImportNote['severity'], step: string, message: string): void => {
    notes.push({ severity, step, message });
  };

  const tool = options.tool ?? detectTool(markup);
  const doc = parseSvg(markup);
  note('info', 'detect', `source looks like ${TOOL_LABELS[tool]}`);

  if (options.stripMetadata !== false) {
    const stripped = stripEditorMetadata(doc);
    if (stripped.elements > 0 || stripped.attributes > 0) {
      note('info', 'metadata', `removed ${stripped.elements} editor element(s) and ${stripped.attributes} editor attribute(s)`);
    }
  }

  let inline: InlineResult | undefined;
  if (options.inlineCss !== false) {
    inline = inlineStyles(doc);
    if (inline.styleElements > 0) {
      note('info', 'css', `flattened ${inline.rules} rule(s) from ${inline.styleElements} <style> element(s) into attributes`);
    }
    if (inline.styleAttributes > 0) {
      note('info', 'css', `flattened ${inline.styleAttributes} style="…" attribute(s)`);
    }
    for (const warning of inline.warnings) note('warning', 'css', warning);
  }

  if (options.modernizeRefs !== false) {
    const refs = normalizeReferences(doc);
    if (refs.rewritten > 0) note('info', 'refs', `rewrote ${refs.rewritten} xlink:href reference(s) as href`);
    for (const id of refs.dangling) note('warning', 'refs', `reference to missing id "${id}"`);
  }

  const pruned = pruneEmptyDefs(doc);
  if (pruned > 0) note('info', 'defs', `removed ${pruned} empty <defs>`);

  const canvas = options.normalizeCanvas === false
    ? { width: 0, height: 0, viewBox: [0, 0, 0, 0] as const, derived: false, sourceUnit: undefined }
    : normalizeCanvas(doc);
  if (canvas.derived) {
    note('info', 'canvas', `derived a viewBox of ${canvas.width}×${canvas.height} from the physical size`);
  }
  if (canvas.sourceUnit !== undefined && canvas.sourceUnit !== 'px') {
    note('info', 'canvas', `source canvas was in ${canvas.sourceUnit}; width and height are now in user units`);
  }

  if (options.assignIds !== false) {
    const ids = assignIds(doc, options.idPrefix ?? 'el');
    if (ids.generated > 0) note('info', 'ids', `generated ${ids.generated} element id(s)`);
    if (ids.sanitized > 0) note('info', 'ids', `rewrote ${ids.sanitized} id(s) to be unique and CSS-safe`);
  }

  const layers = detectLayers(doc);
  note('info', 'layers', `found ${layers.length} layer(s)`);

  const elementIds: string[] = [];
  const collect = (el: typeof doc.root): void => {
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      const id = child.attrs.find((a) => a.name === 'id');
      if (id !== undefined) elementIds.push(id.raw);
      collect(child);
    }
  };
  collect(doc.root);

  const svg = serializeSvg(doc);
  const scene = createScene({
    width: canvas.width,
    height: canvas.height,
    ...options.scene,
    source: svg,
  });

  if (elementIds.length === 0) {
    note('error', 'structure', 'the document has no animatable elements');
  }

  return {
    doc,
    svg,
    scene,
    tool,
    width: canvas.width,
    height: canvas.height,
    layers,
    elementIds,
    notes,
  };
}

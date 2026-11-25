/**
 * Normalization of a drawing tool's SVG export.
 *
 * CorelDRAW, Inkscape and Illustrator all write valid SVG, but each adds its
 * own editor metadata, its own units and its own reference style. This module
 * removes what only the editor understands, makes the canvas explicit and
 * rewrites references into the modern form, so the rest of the pipeline sees
 * one predictable document.
 */

import { getAttr, removeAttr, setAttr, walk } from '@svg-motion-studio/svg';
import { localName, type SvgDocument, type SvgElement } from '@svg-motion-studio/svg';
import { isKnownUnit, parseLength, toPx, tidy } from './units.js';

/** Elements that only carry editor state and never render. */
const EDITOR_ELEMENTS: ReadonlySet<string> = new Set(['metadata', 'namedview', 'RDF', 'rdf']);

/** Attribute prefixes owned by an editor or a metadata vocabulary. */
const EDITOR_PREFIXES: readonly string[] = ['sodipodi:', 'inkscape:', 'corel:', 'i:', 'rdf:', 'dc:', 'cc:', 'ns1:'];

/** Attributes that are harmless but meaningless outside the editor. */
const EDITOR_ATTRIBUTES: ReadonlySet<string> = new Set([
  'enable-background',
  'xmlns:sodipodi',
  'xmlns:inkscape',
  'xmlns:corel',
  'xmlns:i',
  'xmlns:rdf',
  'xmlns:dc',
  'xmlns:cc',
  'xmlns:ns1',
  'xmlns:graph',
  'xmlns:odm',
  'xmlns:svg',
]);

/** What {@link stripEditorMetadata} removed. */
interface StripResult {
  /** Number of elements removed. */
  readonly elements: number;
  /** Number of attributes removed. */
  readonly attributes: number;
}

/**
 * Remove editor-only elements (`<metadata>`, `<sodipodi:namedview>`, RDF
 * blocks) and editor-only attributes (`inkscape:*`, `sodipodi:*`, `corel:*`,
 * `i:*`, `enable-background`, unused namespace declarations).
 */
export function stripEditorMetadata(doc: SvgDocument): StripResult {
  let elements = 0;
  let attributes = 0;

  const prune = (el: SvgElement): void => {
    const kept = el.children.filter((child) => {
      if (child.type !== 'element') return true;
      const name = localName(child.name);
      if (EDITOR_ELEMENTS.has(name) || EDITOR_ELEMENTS.has(child.name)) {
        elements++;
        return false;
      }
      return true;
    });
    el.children = kept;
    for (const child of el.children) if (child.type === 'element') prune(child);
  };
  prune(doc.root);
  doc.children = doc.children.filter((child) => {
    if (child.type !== 'element') return true;
    const name = localName(child.name);
    if (EDITOR_ELEMENTS.has(name) || EDITOR_ELEMENTS.has(child.name)) {
      elements++;
      return false;
    }
    return true;
  });

  walk(doc, (el) => {
    // Keep the editor's human label before dropping the namespace: it is the
    // only readable name a layer has, and the layer panel needs it.
    const label = getAttr(el, 'inkscape:label') ?? getAttr(el, 'corel:label');
    if (label !== undefined && label !== '' && getAttr(el, 'data-name') === undefined) {
      setAttr(el, 'data-name', label);
    }
    const before = el.attrs.length;
    el.attrs = el.attrs.filter((a) => {
      if (EDITOR_ATTRIBUTES.has(a.name)) return false;
      if (EDITOR_PREFIXES.some((p) => a.name.startsWith(p))) return false;
      return true;
    });
    attributes += before - el.attrs.length;
  });

  return { elements, attributes };
}

/** What {@link normalizeCanvas} changed. */
interface CanvasResult {
  /** Width in user units. */
  readonly width: number;
  /** Height in user units. */
  readonly height: number;
  /** `[minX, minY, width, height]`. */
  readonly viewBox: readonly [number, number, number, number];
  /** True when a `viewBox` had to be derived from `width` / `height`. */
  readonly derived: boolean;
  /** Unit of the source `width` / `height`, when it had one. */
  readonly sourceUnit?: string;
}

/**
 * Make the canvas explicit: keep a valid `viewBox`, and rewrite `width` /
 * `height` in pixels so the document has a predictable intrinsic size.
 *
 * When there is no `viewBox`, one is derived from the physical size, which is
 * what a millimetre-based CorelDRAW or Inkscape export needs.
 */
export function normalizeCanvas(doc: SvgDocument): CanvasResult {
  const root = doc.root;
  const rawWidth = getAttr(root, 'width');
  const rawHeight = getAttr(root, 'height');
  const w = parseLength(rawWidth);
  const h = parseLength(rawHeight);
  const sourceUnit = w?.unit ?? h?.unit;

  const vbRaw = (getAttr(root, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasViewBox = vbRaw.length === 4 && vbRaw.every(Number.isFinite) && vbRaw[2] > 0 && vbRaw[3] > 0;

  if (hasViewBox) {
    const viewBox = [vbRaw[0], vbRaw[1], vbRaw[2], vbRaw[3]] as const;
    setAttr(root, 'viewBox', viewBox.map((n) => tidy(n)).join(' '));
    setAttr(root, 'width', tidy(viewBox[2]));
    setAttr(root, 'height', tidy(viewBox[3]));
    return { width: viewBox[2], height: viewBox[3], viewBox, derived: false, sourceUnit };
  }

  const width = w === undefined ? 300 : tidy(toPx(w));
  const height = h === undefined ? 150 : tidy(toPx(h));
  const viewBox = [0, 0, width, height] as const;
  setAttr(root, 'viewBox', viewBox.map((n) => tidy(n)).join(' '));
  setAttr(root, 'width', width);
  setAttr(root, 'height', height);
  return { width, height, viewBox, derived: true, sourceUnit };
}

/** What {@link normalizeReferences} changed. */
interface RefResult {
  /** Number of `xlink:href` attributes rewritten to `href`. */
  readonly rewritten: number;
  /** References that point at an id that does not exist. */
  readonly dangling: readonly string[];
}

/**
 * Rewrite `xlink:href` as `href` (SVG 2), drop the now-unused `xlink`
 * namespace, and report references to ids that do not exist.
 */
export function normalizeReferences(doc: SvgDocument): RefResult {
  const ids = new Set<string>();
  walk(doc, (el) => {
    const id = getAttr(el, 'id');
    if (id !== undefined) ids.add(id);
  });

  let rewritten = 0;
  const dangling = new Set<string>();
  walk(doc, (el) => {
    const xlink = getAttr(el, 'xlink:href');
    if (xlink !== undefined) {
      if (getAttr(el, 'href') === undefined) setAttr(el, 'href', xlink);
      removeAttr(el, 'xlink:href');
      rewritten++;
    }
    for (const name of ['href', 'fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']) {
      const value = getAttr(el, name);
      if (value === undefined) continue;
      const m = /url\(\s*#([^)\s]+)\s*\)/.exec(value);
      const target = m !== null ? m[1] : name === 'href' && value.startsWith('#') ? value.slice(1) : undefined;
      if (target !== undefined && !ids.has(target)) dangling.add(target);
    }
  });

  if (rewritten > 0) removeAttr(doc.root, 'xmlns:xlink');
  return { rewritten, dangling: [...dangling] };
}

/**
 * Remove empty `<defs>` containers left behind by the editor, and drop
 * `<defs>` that only held editor metadata.
 */
export function pruneEmptyDefs(doc: SvgDocument): number {
  let removed = 0;
  const prune = (el: SvgElement): void => {
    el.children = el.children.filter((child) => {
      if (child.type !== 'element') return true;
      if (localName(child.name) === 'defs' && child.children.every((c) => c.type !== 'element')) {
        removed++;
        return false;
      }
      return true;
    });
    for (const child of el.children) if (child.type === 'element') prune(child);
  };
  prune(doc.root);
  return removed;
}

/** True when the document declares a unit we can convert. */
export function hasPhysicalUnits(doc: SvgDocument): boolean {
  const w = parseLength(getAttr(doc.root, 'width'));
  return w !== undefined && isKnownUnit(w.unit) && w.unit !== 'px';
}

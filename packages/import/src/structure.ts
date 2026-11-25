/**
 * Structure: stable element ids and layer detection.
 *
 * Animation binds to ids, so every animatable element needs one that survives
 * a round trip. Drawing tools produce ids like `path1234`, `Layer_x0020_1` or
 * nothing at all; this module makes them predictable, unique and safe to use
 * in a CSS selector.
 */

import { getAttr, setAttr, walk } from '@svg-motion-studio/svg';
import { localName, type SvgDocument, type SvgElement } from '@svg-motion-studio/svg';

/** Elements that can carry an animation target. */
const ANIMATABLE: ReadonlySet<string> = new Set([
  'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'image', 'use', 'stop', 'svg', 'a', 'switch', 'foreignObject',
]);

/** A layer found in the document. */
export interface Layer {
  /** Element id of the layer group. */
  readonly id: string;
  /** Human name: the editor's label, or a readable form of the id. */
  readonly name: string;
  /** Number of animatable elements inside, including the group itself. */
  readonly elements: number;
  /** True when the group is hidden (`display:none` or `visibility:hidden`). */
  readonly hidden: boolean;
}

/** What {@link assignIds} changed. */
interface IdResult {
  /** Number of ids generated. */
  readonly generated: number;
  /** Number of ids rewritten because they were invalid or duplicated. */
  readonly sanitized: number;
}

/** Make a string safe as an id and as a CSS identifier. */
export function sanitizeId(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned === '') return '';
  return /^[0-9]/.test(cleaned) ? `e${cleaned}` : cleaned;
}

/** A readable name from an id: `Layer_x0020_1` → `Layer 1`. */
export function readableName(id: string): string {
  return id
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Give every animatable element a unique, CSS-safe id.
 *
 * Existing ids are kept when they are already valid and unique; the rest are
 * sanitized, and elements without an id get `el-1`, `el-2`, … in document
 * order. The root `<svg>` is left alone.
 */
export function assignIds(doc: SvgDocument, prefix = 'el'): IdResult {
  const used = new Set<string>();
  let generated = 0;
  let sanitized = 0;
  let counter = 0;

  const nextId = (): string => {
    let candidate: string;
    do {
      counter++;
      candidate = `${prefix}-${counter}`;
    } while (used.has(candidate));
    return candidate;
  };

  walk(doc, (el) => {
    if (el === doc.root) return;
    if (!ANIMATABLE.has(localName(el.name))) return;
    const current = getAttr(el, 'id');
    if (current === undefined || current === '') {
      const id = nextId();
      setAttr(el, 'id', id);
      used.add(id);
      generated++;
      return;
    }
    const clean = sanitizeId(current);
    if (clean === '' || used.has(clean)) {
      const id = nextId();
      setAttr(el, 'id', id);
      used.add(id);
      sanitized++;
      return;
    }
    if (clean !== current) {
      setAttr(el, 'id', clean);
      sanitized++;
    }
    used.add(clean);
  });

  return { generated, sanitized };
}

/** Count animatable elements inside a subtree, including the root of it. */
function countAnimatable(el: SvgElement): number {
  let n = ANIMATABLE.has(localName(el.name)) ? 1 : 0;
  for (const child of el.children) if (child.type === 'element') n += countAnimatable(child);
  return n;
}

/** True when the element or an ancestor hides it. */
function isHidden(el: SvgElement): boolean {
  const display = getAttr(el, 'display');
  const visibility = getAttr(el, 'visibility');
  const opacity = getAttr(el, 'opacity');
  return display === 'none' || visibility === 'hidden' || opacity === '0';
}

/**
 * Detect layers: the top-level `<g>` children of the root.
 *
 * Inkscape marks them with `inkscape:groupmode="layer"` and a label;
 * CorelDRAW and Illustrator just emit a group per layer. When the document has
 * no top-level groups, the whole drawing is reported as one layer.
 */
export function detectLayers(doc: SvgDocument): Layer[] {
  const groups = doc.root.children.filter(
    (child): child is SvgElement => child.type === 'element' && localName(child.name) === 'g',
  );

  if (groups.length === 0) {
    const id = getAttr(doc.root, 'id') ?? 'root';
    return [{ id, name: 'Drawing', elements: countAnimatable(doc.root), hidden: false }];
  }

  return groups.map((g) => {
    const id = getAttr(g, 'id') ?? 'layer';
    const label = getAttr(g, 'inkscape:label') ?? getAttr(g, 'data-name') ?? getAttr(g, 'aria-label');
    return {
      id,
      name: label !== undefined && label !== '' ? label : readableName(id),
      elements: countAnimatable(g),
      hidden: isHidden(g),
    };
  });
}

/**
 * Wrap an element in a `<g>` that carries its static `transform`, so the
 * element itself is free for animation.
 *
 * Both exporters can then animate the element without fighting the transform
 * it was drawn with — SMIL composes additively, and CSS replaces the property.
 * Returns the new wrapper, or `undefined` when the element had no transform.
 */
export function hoistTransform(doc: SvgDocument, el: SvgElement): SvgElement | undefined {
  const transform = getAttr(el, 'transform');
  if (transform === undefined || transform.trim() === '') return undefined;

  const wrapper: SvgElement = {
    type: 'element',
    name: 'g',
    attrs: [{ name: 'transform', raw: transform, quote: '"' }],
    children: [el],
    selfClosing: false,
  };
  el.attrs = el.attrs.filter((a) => a.name !== 'transform');

  const replace = (parent: SvgElement): boolean => {
    const i = parent.children.indexOf(el);
    if (i !== -1) {
      parent.children[i] = wrapper;
      return true;
    }
    for (const child of parent.children) {
      if (child.type === 'element' && replace(child)) return true;
    }
    return false;
  };
  replace(doc.root);
  return wrapper;
}

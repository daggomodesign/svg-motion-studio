/**
 * Small helpers to read and edit a parsed SVG tree.
 * They work on the plain objects produced by `parseSvg` — no browser DOM.
 */

import {
  decodeEntities,
  escapeAttr,
  escapeText,
  type SvgCData,
  type SvgDocument,
  type SvgElement,
  type SvgNode,
  type SvgText,
} from './xml.js';

/** True when `node` is an element. */
export function isElement(node: SvgNode | undefined): node is SvgElement {
  return node !== undefined && node.type === 'element';
}

/** Decoded value of attribute `name`, or `undefined` when absent. */
export function getAttr(el: SvgElement, name: string): string | undefined {
  const a = el.attrs.find((x) => x.name === name);
  return a === undefined ? undefined : decodeEntities(a.raw);
}

/** Set attribute `name` to `value` (escaped for you). Existing attributes keep their position. */
export function setAttr(el: SvgElement, name: string, value: string | number): void {
  const raw = escapeAttr(String(value));
  const a = el.attrs.find((x) => x.name === name);
  if (a === undefined) el.attrs.push({ name, raw, quote: '"' });
  else {
    a.raw = raw;
    a.quote = '"';
  }
}

/** Remove attribute `name`. Returns whether it existed. */
export function removeAttr(el: SvgElement, name: string): boolean {
  const i = el.attrs.findIndex((x) => x.name === name);
  if (i === -1) return false;
  el.attrs.splice(i, 1);
  return true;
}

/** Create an element. Attribute values are escaped; `undefined` values are skipped. */
export function createElement(
  name: string,
  attrs: Readonly<Record<string, string | number | undefined>> = {},
  children: SvgNode[] = [],
): SvgElement {
  const el: SvgElement = { type: 'element', name, attrs: [], children, selfClosing: true };
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) setAttr(el, key, value);
  }
  return el;
}

/** Create a text node from plain (unescaped) text. */
export function createText(value: string): SvgText {
  return { type: 'text', raw: escapeText(value) };
}

/** Create a CDATA section; a `]]>` inside `value` is split safely. */
export function createCData(value: string): SvgCData {
  return { type: 'cdata', value: value.split(']]>').join(']]]]><![CDATA[>') };
}

/** Append `child` as the last child of `parent`. */
export function appendChild(parent: SvgElement, child: SvgNode): void {
  parent.children.push(child);
}

/** Insert `child` as the first child of `parent`. */
export function prependChild(parent: SvgElement, child: SvgNode): void {
  parent.children.unshift(child);
}

/**
 * Visit every element depth-first, in document order. Return `false` from
 * `visit` to skip that element's children.
 */
export function walk(
  start: SvgDocument | SvgNode,
  visit: (el: SvgElement, parent: SvgElement | undefined) => void | false,
): void {
  const go = (node: SvgNode, parent: SvgElement | undefined): void => {
    if (node.type !== 'element') return;
    if (visit(node, parent) === false) return;
    for (const child of node.children) go(child, node);
  };
  if ('root' in start) go(start.root, undefined);
  else go(start, undefined);
}

/** Map every `id` to its element. When an id repeats, the first element wins (like browsers). */
export function indexIds(doc: SvgDocument): Map<string, SvgElement> {
  const ids = new Map<string, SvgElement>();
  walk(doc, (el) => {
    const id = getAttr(el, 'id');
    if (id !== undefined && !ids.has(id)) ids.set(id, el);
  });
  return ids;
}

/** First element with the given `id`, or `undefined`. */
export function findById(doc: SvgDocument, id: string): SvgElement | undefined {
  let found: SvgElement | undefined;
  walk(doc, (el) => {
    if (found !== undefined) return false;
    if (getAttr(el, 'id') === id) found = el;
  });
  return found;
}

/** Deep copy of a node. */
export function cloneNode<T extends SvgNode>(node: T): T {
  if (node.type !== 'element') return { ...node };
  return {
    ...node,
    attrs: node.attrs.map((a) => ({ ...a })),
    children: node.children.map((c) => cloneNode(c)),
  };
}

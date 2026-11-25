/**
 * CSS inlining: turn `<style>` rules and `style="…"` attributes into plain
 * presentation attributes.
 *
 * Drawing tools style their output with CSS classes (`.st0{fill:#FF0000}` in
 * Illustrator, `.fil0` in CorelDRAW, `#path1234{…}` in Inkscape). Animation
 * needs the values on the element itself, so the import flattens the cascade
 * once and the exporters never have to think about CSS specificity again.
 *
 * Supported selectors: type, `*`, `.class`, `#id`, compounds of those, and
 * descendant / child combinators. Sibling combinators, attribute selectors and
 * pseudo-classes are reported and skipped.
 */

import { getAttr, removeAttr, setAttr, walk } from '@svg-motion-studio/svg';
import { localName, type SvgDocument, type SvgElement } from '@svg-motion-studio/svg';

/** SVG presentation attributes — the properties that can live on an element. */
export const PRESENTATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'alignment-baseline', 'baseline-shift', 'clip', 'clip-path', 'clip-rule', 'color',
  'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'cursor',
  'direction', 'display', 'dominant-baseline', 'fill', 'fill-opacity', 'fill-rule',
  'filter', 'flood-color', 'flood-opacity', 'font-family', 'font-size', 'font-size-adjust',
  'font-stretch', 'font-style', 'font-variant', 'font-weight', 'image-rendering',
  'letter-spacing', 'lighting-color', 'marker-end', 'marker-mid', 'marker-start', 'mask',
  'opacity', 'overflow', 'paint-order', 'pointer-events', 'shape-rendering', 'stop-color',
  'stop-opacity', 'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor',
  'text-decoration', 'text-rendering', 'transform', 'transform-origin', 'unicode-bidi',
  'vector-effect', 'visibility', 'word-spacing', 'writing-mode',
]);

/** One `property: value` pair. */
export interface Declaration {
  /** Lower-case property name. */
  readonly prop: string;
  /** Value, with `!important` stripped. */
  readonly value: string;
}

/** A compound selector: `rect.big#hero`. */
interface Compound {
  readonly tag?: string;
  readonly id?: string;
  readonly classes: readonly string[];
}

/** A full selector: compounds joined by combinators. */
interface Selector {
  readonly compounds: readonly Compound[];
  /** `combinators[i]` joins `compounds[i]` to `compounds[i + 1]`. */
  readonly combinators: readonly ('' | '>' | '+' | '~')[];
  /** `[ids, classes, types]`, used to order the cascade. */
  readonly specificity: readonly [number, number, number];
}

/** A parsed rule. */
interface Rule {
  readonly selectors: readonly Selector[];
  readonly declarations: readonly Declaration[];
  /** Source order, for equal specificity. */
  readonly order: number;
}

/** Result of {@link inlineStyles}. */
 export interface InlineResult {
  /** Number of `<style>` elements removed. */
  readonly styleElements: number;
  /** Number of rules applied. */
  readonly rules: number;
  /** Number of `style="…"` attributes flattened. */
  readonly styleAttributes: number;
  /** Selectors or declarations that could not be represented. */
  readonly warnings: readonly string[];
}

/** Split a declaration block into pairs, respecting parentheses and quotes. */
export function parseDeclarations(block: string): Declaration[] {
  const out: Declaration[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (chunk: string): void => {
    const i = chunk.indexOf(':');
    if (i === -1) return;
    const prop = chunk.slice(0, i).trim().toLowerCase();
    let value = chunk.slice(i + 1).trim();
    if (prop === '' || value === '') return;
    value = value.replace(/\s*!important\s*$/i, '').trim();
    out.push({ prop, value });
  };
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (quote !== '') {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      push(block.slice(start, i));
      start = i + 1;
    }
  }
  push(block.slice(start));
  return out;
}

const COMPOUND = /^([A-Za-z*][\w-]*)?((?:[.#][\w-]+)*)$/;

/** Parse one compound selector, or `undefined` when unsupported. */
function parseCompound(text: string): Compound | undefined {
  const m = COMPOUND.exec(text);
  if (m === null) return undefined;
  const tag = m[1] === undefined || m[1] === '*' ? undefined : m[1].toLowerCase();
  const rest = m[2] ?? '';
  let id: string | undefined;
  const classes: string[] = [];
  const re = /([.#])([\w-]+)/g;
  let part: RegExpExecArray | null;
  while ((part = re.exec(rest)) !== null) {
    if (part[1] === '#') id = part[2];
    else classes.push(part[2]);
  }
  if (tag === undefined && id === undefined && classes.length === 0) return undefined;
  return { tag, id, classes };
}

/** Parse a selector list entry, or `undefined` when unsupported. */
export function parseSelector(text: string): Selector | undefined {
  const normalized = text.trim().replace(/\s*([>+~])\s*/g, ' $1 ');
  if (normalized === '') return undefined;
  const tokens = normalized.split(/\s+/).filter((t) => t !== '');
  const compounds: Compound[] = [];
  const combinators: ('' | '>' | '+' | '~')[] = [];
  let pending: '' | '>' | '+' | '~' = '';
  for (const token of tokens) {
    if (token === '>' || token === '+' || token === '~') {
      if (compounds.length === 0) return undefined;
      pending = token;
      continue;
    }
    const compound = parseCompound(token);
    if (compound === undefined) return undefined;
    if (compounds.length > 0) combinators.push(pending === '' ? '' : pending);
    compounds.push(compound);
    pending = '';
  }
  if (compounds.length === 0) return undefined;
  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const c of compounds) {
    if (c.id !== undefined) ids++;
    classes += c.classes.length;
    if (c.tag !== undefined) types++;
  }
  return { compounds, combinators, specificity: [ids, classes, types] };
}

/** Parse a stylesheet into rules, skipping at-rules. */
export function parseStylesheet(css: string, warnings: string[]): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let i = 0;
  let order = 0;
  while (i < clean.length) {
    const open = clean.indexOf('{', i);
    if (open === -1) break;
    const prelude = clean.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < clean.length && depth > 0) {
      if (clean[j] === '{') depth++;
      else if (clean[j] === '}') depth--;
      j++;
    }
    const body = clean.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith('@')) {
      warnings.push(`at-rule \`${prelude.split(/\s/)[0]}\` is not inlined`);
      continue;
    }
    const declarations = parseDeclarations(body);
    if (declarations.length === 0) continue;
    const selectors: Selector[] = [];
    for (const part of prelude.split(',')) {
      const selector = parseSelector(part);
      if (selector === undefined) {
        warnings.push(`selector \`${part.trim()}\` is not supported and was skipped`);
        continue;
      }
      if (selector.combinators.some((c) => c === '+' || c === '~')) {
        warnings.push(`sibling combinator in \`${part.trim()}\` is not supported and was skipped`);
        continue;
      }
      selectors.push(selector);
    }
    if (selectors.length === 0) continue;
    rules.push({ selectors, declarations, order: order++ });
  }
  return rules;
}

/** True when `el` matches one compound selector. */
function matchesCompound(el: SvgElement, compound: Compound): boolean {
  if (compound.tag !== undefined && localName(el.name).toLowerCase() !== compound.tag) return false;
  if (compound.id !== undefined && getAttr(el, 'id') !== compound.id) return false;
  if (compound.classes.length > 0) {
    const own = (getAttr(el, 'class') ?? '').split(/\s+/).filter((c) => c !== '');
    for (const c of compound.classes) if (!own.includes(c)) return false;
  }
  return true;
}

/** True when `el` matches a full selector, walking up the ancestor chain. */
function matchesSelector(
  el: SvgElement,
  selector: Selector,
  parents: ReadonlyMap<SvgElement, SvgElement | undefined>,
): boolean {
  const { compounds, combinators } = selector;
  if (!matchesCompound(el, compounds[compounds.length - 1])) return false;
  let current: SvgElement | undefined = el;
  for (let k = compounds.length - 2; k >= 0; k--) {
    const combinator = combinators[k];
    const target = compounds[k];
    if (combinator === '>') {
      const parent = parents.get(current as SvgElement);
      if (parent === undefined || !matchesCompound(parent, target)) return false;
      current = parent;
      continue;
    }
    // Descendant: climb until a match, or the root.
    let ancestor = parents.get(current as SvgElement);
    let found: SvgElement | undefined;
    while (ancestor !== undefined) {
      if (matchesCompound(ancestor, target)) {
        found = ancestor;
        break;
      }
      ancestor = parents.get(ancestor);
    }
    if (found === undefined) return false;
    current = found;
  }
  return true;
}

const compareSpecificity = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Flatten `<style>` rules and `style="…"` attributes into presentation
 * attributes, then remove the `<style>` elements.
 *
 * `style="…"` wins over stylesheet rules, exactly like in a browser.
 */
export function inlineStyles(doc: SvgDocument): InlineResult {
  const warnings: string[] = [];
  const parents = new Map<SvgElement, SvgElement | undefined>();
  walk(doc, (el, parent) => {
    parents.set(el, parent);
  });

  // 1. Collect stylesheet text from every <style> element.
  const styleElements: SvgElement[] = [];
  let css = '';
  walk(doc, (el) => {
    if (localName(el.name) !== 'style') return;
    styleElements.push(el);
    for (const child of el.children) {
      if (child.type === 'text') css += child.raw;
      else if (child.type === 'cdata') css += child.value;
    }
  });

  const rules = parseStylesheet(css, warnings);

  // 2. Apply matching rules in cascade order.
  let applied = 0;
  if (rules.length > 0) {
    walk(doc, (el) => {
      const hits: { rule: Rule; specificity: readonly [number, number, number] }[] = [];
      for (const rule of rules) {
        for (const selector of rule.selectors) {
          if (matchesSelector(el, selector, parents)) {
            hits.push({ rule, specificity: selector.specificity });
            break;
          }
        }
      }
      if (hits.length === 0) return;
      hits.sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.rule.order - b.rule.order);
      for (const hit of hits) {
        for (const decl of hit.rule.declarations) {
          if (PRESENTATION_ATTRIBUTES.has(decl.prop)) setAttr(el, decl.prop, decl.value);
          else if (!warnings.includes(`property \`${decl.prop}\` is not a presentation attribute`)) {
            warnings.push(`property \`${decl.prop}\` is not a presentation attribute`);
          }
        }
        applied++;
      }
    });
  }

  // 3. Flatten style="…" over the result.
  let styleAttributes = 0;
  walk(doc, (el) => {
    const style = getAttr(el, 'style');
    if (style === undefined) return;
    const declarations = parseDeclarations(style);
    const leftover: Declaration[] = [];
    for (const decl of declarations) {
      if (PRESENTATION_ATTRIBUTES.has(decl.prop)) setAttr(el, decl.prop, decl.value);
      else leftover.push(decl);
    }
    styleAttributes++;
    if (leftover.length === 0) removeAttr(el, 'style');
    else setAttr(el, 'style', leftover.map((d) => `${d.prop}:${d.value}`).join(';'));
  });

  // 4. Drop the <style> elements (and their text) from the tree.
  const drop = new Set<SvgElement>(styleElements);
  const prune = (el: SvgElement): void => {
    el.children = el.children.filter((child) => !(child.type === 'element' && drop.has(child)));
    for (const child of el.children) if (child.type === 'element') prune(child);
  };
  prune(doc.root);
  doc.children = doc.children.filter((child) => !(child.type === 'element' && drop.has(child)));

  return { styleElements: styleElements.length, rules: applied, styleAttributes, warnings };
}

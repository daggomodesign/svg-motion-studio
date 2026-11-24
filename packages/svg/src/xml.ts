/**
 * Lossless SVG/XML parsing and serialization.
 *
 * The tree keeps everything needed to write the document back byte for byte:
 * attribute values stay in their raw (escaped) form with their original quote,
 * text stays raw, and comments, CDATA sections, processing instructions and
 * doctypes are preserved. `serializeSvg(parseSvg(x)) === x` for any well-formed
 * input (apart from a leading byte-order mark, which is dropped).
 *
 * This is a small, non-validating parser written for SVG documents. It does
 * not expand entities declared in a DOCTYPE; unknown entity references are
 * kept as written.
 */

/** One attribute, as written in the source. */
export interface SvgAttr {
  /** Qualified name, e.g. `fill` or `xlink:href`. */
  name: string;
  /** Value exactly as written between the quotes (entities NOT decoded). */
  raw: string;
  /** Quote character used in the source. */
  quote: '"' | "'";
}

/** An element node. */
export interface SvgElement {
  /** Node discriminator. */
  readonly type: 'element';
  /** Qualified tag name, e.g. `circle` or `svg:g`. */
  name: string;
  /** Attributes in source order. */
  attrs: SvgAttr[];
  /** Child nodes in document order. */
  children: SvgNode[];
  /** Written as `<x/>` when it has no children (otherwise `<x></x>`). */
  selfClosing: boolean;
}

/** Character data, kept raw (entities NOT decoded). */
export interface SvgText {
  /** Node discriminator. */
  readonly type: 'text';
  /** Text exactly as written. */
  raw: string;
}

/** `<!-- … -->` */
export interface SvgComment {
  /** Node discriminator. */
  readonly type: 'comment';
  /** Comment body. */
  value: string;
}

/** `<![CDATA[ … ]]>` */
export interface SvgCData {
  /** Node discriminator. */
  readonly type: 'cdata';
  /** Section body. */
  value: string;
}

/** A processing instruction (`<?xml …?>`) or doctype, kept verbatim. */
export interface SvgRaw {
  /** Node discriminator. */
  readonly type: 'raw';
  /** Markup exactly as written, delimiters included. */
  value: string;
}

/** Any node of the tree. */
export type SvgNode = SvgElement | SvgText | SvgComment | SvgCData | SvgRaw;

/** A parsed document. */
export interface SvgDocument {
  /** Top-level nodes (prolog, root element, trailing comments…). */
  children: SvgNode[];
  /** The root `<svg>` element (also present in `children`). */
  root: SvgElement;
}

/** Thrown by {@link parseSvg} for malformed markup. */
export class SvgParseError extends Error {
  /** 1-based line of the problem. */
  readonly line: number;
  /** 1-based column of the problem. */
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'SvgParseError';
    this.line = line;
    this.column = column;
  }
}

const NAME = /[A-Za-z_:\u00C0-\uFFFF][-A-Za-z0-9_:.\u00B7\u00C0-\uFFFF]*/y;
const SPACE = /[ \t\r\n]*/y;

/** Local part of a qualified name: `svg:path` → `path`. */
export function localName(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

/**
 * Parse SVG markup into a lossless tree.
 * Throws {@link SvgParseError} with a line/column for malformed input, and
 * when the root element is not `<svg>`.
 */
export function parseSvg(markup: string): SvgDocument {
  const s = markup;
  const n = s.length;
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  const top: SvgNode[] = [];
  const stack: SvgElement[] = [];

  const fail = (msg: string, at: number): never => {
    let line = 1;
    let col = 1;
    for (let k = 0; k < at && k < n; k++) {
      if (s.charCodeAt(k) === 10) {
        line++;
        col = 1;
      } else col++;
    }
    throw new SvgParseError(msg, line, col);
  };
  const push = (node: SvgNode): void => {
    (stack.length > 0 ? stack[stack.length - 1].children : top).push(node);
  };
  const readName = (at: number): string => {
    NAME.lastIndex = at;
    const m = NAME.exec(s);
    return m === null ? fail('expected a name', at) : m[0];
  };
  const skipSpace = (at: number): number => {
    SPACE.lastIndex = at;
    SPACE.exec(s);
    return SPACE.lastIndex;
  };
  const until = (token: string, from: number, what: string, at: number): number => {
    const end = s.indexOf(token, from);
    return end === -1 ? fail(`unterminated ${what}`, at) : end;
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) {
      push({ type: 'text', raw: s.slice(i) });
      break;
    }
    if (lt > i) push({ type: 'text', raw: s.slice(i, lt) });
    i = lt;

    if (s.startsWith('<!--', i)) {
      const end = until('-->', i + 4, 'comment', i);
      push({ type: 'comment', value: s.slice(i + 4, end) });
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = until(']]>', i + 9, 'CDATA section', i);
      push({ type: 'cdata', value: s.slice(i + 9, end) });
      i = end + 3;
    } else if (s.startsWith('<?', i)) {
      const end = until('?>', i + 2, 'processing instruction', i);
      push({ type: 'raw', value: s.slice(i, end + 2) });
      i = end + 2;
    } else if (s.startsWith('<!', i)) {
      // Doctype (possibly with an internal subset in brackets).
      let j = i + 2;
      let depth = 0;
      let quote = '';
      for (; j < n; j++) {
        const c = s[j];
        if (quote !== '') {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= n) fail('unterminated declaration', i);
      push({ type: 'raw', value: s.slice(i, j + 1) });
      i = j + 1;
    } else if (s[i + 1] === '/') {
      const name = readName(i + 2);
      const j = skipSpace(i + 2 + name.length);
      if (s[j] !== '>') fail(`expected ">" to close </${name}`, j);
      const open = stack.pop();
      if (open === undefined) fail(`unexpected closing tag </${name}>`, i);
      else if (open.name !== name) fail(`mismatched closing tag </${name}>, expected </${open.name}>`, i);
      i = j + 1;
    } else {
      const name = readName(i + 1);
      const el: SvgElement = { type: 'element', name, attrs: [], children: [], selfClosing: false };
      let j = i + 1 + name.length;
      for (;;) {
        const before = j;
        j = skipSpace(j);
        if (j >= n) fail(`unterminated tag <${name}>`, i);
        if (s[j] === '/' && s[j + 1] === '>') {
          el.selfClosing = true;
          j += 2;
          break;
        }
        if (s[j] === '>') {
          j += 1;
          break;
        }
        if (j === before) fail('expected whitespace between attributes', j);
        const attr = readName(j);
        j = skipSpace(j + attr.length);
        if (s[j] !== '=') fail(`expected "=" after attribute ${attr}`, j);
        j = skipSpace(j + 1);
        const quote = s[j];
        if (quote !== '"' && quote !== "'") fail(`attribute ${attr} needs a quoted value`, j);
        const end = until(quote, j + 1, `value of attribute ${attr}`, j);
        const raw = s.slice(j + 1, end);
        if (raw.includes('<')) fail(`"<" is not allowed in the value of attribute ${attr}`, j);
        if (el.attrs.some((a) => a.name === attr)) fail(`duplicate attribute ${attr}`, j);
        el.attrs.push({ name: attr, raw, quote: quote as '"' | "'" });
        j = end + 1;
      }
      push(el);
      if (!el.selfClosing) stack.push(el);
      i = j;
    }
  }

  if (stack.length > 0) fail(`unclosed tag <${stack[stack.length - 1].name}>`, n);
  const elements = top.filter((node): node is SvgElement => node.type === 'element');
  if (elements.length !== 1) fail(elements.length === 0 ? 'no root element' : 'more than one root element', 0);
  if (top.some((node) => node.type === 'text' && node.raw.trim() !== '')) fail('text outside the root element', 0);
  const root = elements[0];
  if (localName(root.name) !== 'svg') fail(`root element must be <svg>, got <${root.name}>`, 0);
  return { children: top, root };
}

/** Write a document or node back to markup. */
export function serializeSvg(input: SvgDocument | SvgNode): string {
  const out: string[] = [];
  const write = (node: SvgNode): void => {
    switch (node.type) {
      case 'text':
        out.push(node.raw);
        return;
      case 'comment':
        out.push(`<!--${node.value}-->`);
        return;
      case 'cdata':
        out.push(`<![CDATA[${node.value}]]>`);
        return;
      case 'raw':
        out.push(node.value);
        return;
      case 'element': {
        out.push(`<${node.name}`);
        for (const a of node.attrs) out.push(` ${a.name}=${a.quote}${a.raw}${a.quote}`);
        if (node.children.length === 0 && node.selfClosing) {
          out.push('/>');
          return;
        }
        out.push('>');
        node.children.forEach(write);
        out.push(`</${node.name}>`);
      }
    }
  };
  if ('root' in input) input.children.forEach(write);
  else write(input);
  return out.join('');
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Decode the predefined XML entities and numeric character references.
 * Unknown named references (e.g. ones declared in a DOCTYPE) are left as is.
 */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Escape a value for use inside a double-quoted attribute. */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/** Escape a value for use as element text. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

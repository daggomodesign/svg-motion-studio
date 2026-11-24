/**
 * SVG path data (`d` attribute) as an animatable value.
 *
 * Paths are parsed following the SVG 1.1 / SVG 2 path grammar and normalized
 * to a small absolute command set — `M L C Q A Z` — so that two paths drawn
 * with different shorthands (`H`, `V`, `S`, `T`, relative commands) still
 * morph into each other when their structure matches.
 */

import { lerp, round, type ValueType } from './values.js';

/** A normalized absolute path command. */
export type PathCommand =
  | { readonly c: 'M' | 'L'; readonly v: readonly [number, number] }
  | { readonly c: 'C'; readonly v: readonly [number, number, number, number, number, number] }
  | { readonly c: 'Q'; readonly v: readonly [number, number, number, number] }
  | {
      /** rx, ry, x-axis-rotation, large-arc-flag, sweep-flag, x, y */
      readonly c: 'A';
      readonly v: readonly [number, number, number, number, number, number, number];
    }
  | { readonly c: 'Z'; readonly v: readonly [] };

/** A parsed, normalized path. */
export type PathData = readonly PathCommand[];

const ARITY: Readonly<Record<string, number>> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

/**
 * Tokenize path data into command letters and number literals. Numbers stay as
 * text so the parser can split compact arc flags such as `"0110"`.
 */
function tokenize(d: string): string[] {
  const out: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([\s,]+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push(m[2]);
    else if (m[4]) throw new TypeError(`unexpected character "${m[4]}" in path data`);
  }
  return out;
}

/**
 * Parse SVG path data into a normalized absolute {@link PathData}.
 * Throws `TypeError` on malformed input.
 */
export function parsePath(d: string): PathData {
  if (typeof d !== 'string') throw new TypeError(`expected path data string, got ${String(d)}`);
  const tokens = tokenize(d);
  const out: PathCommand[] = [];

  let i = 0;
  let cx = 0; // current point
  let cy = 0;
  let sx = 0; // subpath start
  let sy = 0;
  let lastCtrlX = 0; // last control point, for S/T reflection
  let lastCtrlY = 0;
  let lastCmd = '';

  /** Read the next number; for arc flags, split compact forms like "01". */
  const pending: string[] = [];
  const nextNumber = (flag = false): number => {
    let tok: string;
    if (pending.length > 0) tok = pending.shift() as string;
    else {
      const t = tokens[i];
      if (t === undefined || /^[A-Za-z]$/.test(t)) throw new TypeError('path data ended early');
      i++;
      tok = t;
    }
    if (flag) {
      if (tok[0] !== '0' && tok[0] !== '1') throw new TypeError(`invalid arc flag "${tok}"`);
      if (tok.length > 1) pending.unshift(tok.slice(1));
      return tok[0] === '1' ? 1 : 0;
    }
    const n = Number(tok);
    if (!Number.isFinite(n)) throw new TypeError(`invalid number "${tok}" in path data`);
    return n;
  };
  const hasMoreNumbers = (): boolean =>
    pending.length > 0 || (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]));

  let cmd = '';
  while (i < tokens.length || pending.length > 0) {
    if (!hasMoreNumbers()) {
      cmd = tokens[i++];
    } else if (cmd === '') {
      throw new TypeError('path data must start with a command');
    } else if (cmd === 'z' || cmd === 'Z') {
      throw new TypeError('numbers after Z without a command');
    }
    if (out.length === 0 && cmd !== 'M' && cmd !== 'm') throw new TypeError('path data must start with M');

    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;

    if (ARITY[lower] === undefined) throw new TypeError(`unknown path command "${cmd}"`);

    switch (lower) {
      case 'm': {
        const x = nextNumber() + ox;
        const y = nextNumber() + oy;
        out.push({ c: 'M', v: [x, y] });
        cx = sx = x;
        cy = sy = y;
        cmd = rel ? 'l' : 'L'; // implicit lineto for repeated pairs
        break;
      }
      case 'l': {
        const x = nextNumber() + ox;
        const y = nextNumber() + oy;
        out.push({ c: 'L', v: [x, y] });
        cx = x;
        cy = y;
        break;
      }
      case 'h': {
        const x = nextNumber() + ox;
        out.push({ c: 'L', v: [x, cy] });
        cx = x;
        break;
      }
      case 'v': {
        const y = nextNumber() + oy;
        out.push({ c: 'L', v: [cx, y] });
        cy = y;
        break;
      }
      case 'c': {
        const x1 = nextNumber() + ox, y1 = nextNumber() + oy;
        const x2 = nextNumber() + ox, y2 = nextNumber() + oy;
        const x = nextNumber() + ox, y = nextNumber() + oy;
        out.push({ c: 'C', v: [x1, y1, x2, y2, x, y] });
        lastCtrlX = x2;
        lastCtrlY = y2;
        cx = x;
        cy = y;
        break;
      }
      case 's': {
        const reflect = lastCmd === 'C';
        const x1 = reflect ? 2 * cx - lastCtrlX : cx;
        const y1 = reflect ? 2 * cy - lastCtrlY : cy;
        const x2 = nextNumber() + ox, y2 = nextNumber() + oy;
        const x = nextNumber() + ox, y = nextNumber() + oy;
        out.push({ c: 'C', v: [x1, y1, x2, y2, x, y] });
        lastCtrlX = x2;
        lastCtrlY = y2;
        cx = x;
        cy = y;
        break;
      }
      case 'q': {
        const x1 = nextNumber() + ox, y1 = nextNumber() + oy;
        const x = nextNumber() + ox, y = nextNumber() + oy;
        out.push({ c: 'Q', v: [x1, y1, x, y] });
        lastCtrlX = x1;
        lastCtrlY = y1;
        cx = x;
        cy = y;
        break;
      }
      case 't': {
        const reflect = lastCmd === 'Q';
        const x1 = reflect ? 2 * cx - lastCtrlX : cx;
        const y1 = reflect ? 2 * cy - lastCtrlY : cy;
        const x = nextNumber() + ox, y = nextNumber() + oy;
        out.push({ c: 'Q', v: [x1, y1, x, y] });
        lastCtrlX = x1;
        lastCtrlY = y1;
        cx = x;
        cy = y;
        break;
      }
      case 'a': {
        const rx = nextNumber(), ry = nextNumber(), rot = nextNumber();
        const large = nextNumber(true), sweep = nextNumber(true);
        const x = nextNumber() + ox, y = nextNumber() + oy;
        out.push({ c: 'A', v: [rx, ry, rot, large, sweep, x, y] });
        cx = x;
        cy = y;
        break;
      }
      case 'z': {
        out.push({ c: 'Z', v: [] });
        cx = sx;
        cy = sy;
        break;
      }
    }
    lastCmd = out[out.length - 1].c;
  }

  if (out.length === 0) throw new TypeError('empty path data');
  return out;
}

/** Serialize normalized path data, e.g. `"M0 0 L10 0 Z"`. Numbers are rounded to 3 decimals. */
export function formatPath(path: PathData): string {
  return path
    .map((cmd) => (cmd.v.length === 0 ? cmd.c : `${cmd.c}${cmd.v.map((n) => round(n)).join(' ')}`))
    .join(' ');
}

/** True when two parsed paths have the same command sequence and can morph. */
export function pathsCompatible(a: PathData, b: PathData): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].c !== b[i].c) return false;
  return true;
}

/**
 * Path morphing. Requires compatible structure (see {@link pathsCompatible});
 * arc flags switch at the segment midpoint.
 */
export const pathType: ValueType<string, PathData> = {
  name: 'path',
  parse: parsePath,
  lerp(a, b, t) {
    const out: PathCommand[] = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const ca = a[i];
      const cb = b[i];
      const v = ca.v.map((n, k) => {
        if (ca.c === 'A' && (k === 3 || k === 4)) return t < 0.5 ? n : cb.v[k];
        return lerp(n, cb.v[k], t);
      });
      out[i] = { c: ca.c, v } as unknown as PathCommand;
    }
    return out;
  },
  format: formatPath,
  compatible: pathsCompatible,
};

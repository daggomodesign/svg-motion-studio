/**
 * Value types: how an animatable property is parsed, interpolated and
 * formatted back.
 *
 * A {@link ValueType} turns authoring values (what lives in a keyframe — a
 * number, `"#ff0000"`, a path string) into an internal representation that is
 * cheap to interpolate. Tracks parse once at compile time and only
 * interpolate + format on each sample.
 */

/** Describes how one kind of value is parsed, interpolated and formatted. */
export interface ValueType<V, R = V> {
  /** Stable identifier, e.g. `"number"`, `"color"`. */
  readonly name: string;
  /** Parse an authoring value. Throws `TypeError` on invalid input. */
  parse(value: V): R;
  /** Interpolate between two parsed values. `t` may leave [0, 1] (overshooting easings). */
  lerp(a: R, b: R, t: number): R;
  /** Turn a parsed value back into an authoring value. */
  format(value: R): V;
  /**
   * Whether two parsed values can be interpolated into each other.
   * Omitted means "always". Paths and vectors use it to require a matching
   * structure.
   */
  compatible?(a: R, b: R): boolean;
}

/** Linear interpolation between `a` and `b` at fraction `t` (not clamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Round to a fixed number of decimals and normalize `-0` to `0` (deterministic output). */
export function round(n: number, decimals = 3): number {
  const f = Math.pow(10, decimals);
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
}

// ---------------------------------------------------------------------------
// number
// ---------------------------------------------------------------------------

/** Plain scalar: opacity, rotation, stroke width, a single coordinate… */
export const numberType: ValueType<number> = {
  name: 'number',
  parse(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`expected a finite number, got ${String(value)}`);
    }
    return value;
  },
  lerp,
  format: (value) => value,
};

// ---------------------------------------------------------------------------
// vector
// ---------------------------------------------------------------------------

/** Fixed-length list of numbers: `[x, y]` positions, `[sx, sy]` scales, gradient offsets… */
export const vectorType: ValueType<readonly number[]> = {
  name: 'vector',
  parse(value) {
    if (!Array.isArray(value) || value.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new TypeError(`expected an array of finite numbers, got ${JSON.stringify(value)}`);
    }
    return value;
  },
  lerp(a, b, t) {
    const out = new Array<number>(a.length);
    for (let i = 0; i < a.length; i++) out[i] = lerp(a[i], b[i], t);
    return out;
  },
  format: (value) => value,
  compatible: (a, b) => a.length === b.length,
};

// ---------------------------------------------------------------------------
// color
// ---------------------------------------------------------------------------

/** Parsed color: `[r, g, b, a]` with r, g, b ∈ [0, 255] and a ∈ [0, 1]. */
export type Rgba = readonly [number, number, number, number];

const NAMED_COLORS: Readonly<Record<string, Rgba>> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  red: [255, 0, 0, 1],
  lime: [0, 255, 0, 1],
  green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1],
  yellow: [255, 255, 0, 1],
  cyan: [0, 255, 255, 1],
  aqua: [0, 255, 255, 1],
  magenta: [255, 0, 255, 1],
  fuchsia: [255, 0, 255, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
  silver: [192, 192, 192, 1],
  orange: [255, 165, 0, 1],
  purple: [128, 0, 128, 1],
  navy: [0, 0, 128, 1],
  teal: [0, 128, 128, 1],
  maroon: [128, 0, 0, 1],
  olive: [128, 128, 0, 1],
};

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

function parseChannel(token: string, max: number): number {
  const pct = token.endsWith('%');
  const n = Number(pct ? token.slice(0, -1) : token);
  if (!Number.isFinite(n)) throw new TypeError(`invalid color channel "${token}"`);
  return clamp(pct ? (n / 100) * max : n, 0, max);
}

/**
 * Parse a CSS color: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()`
 * (comma or space syntax, numbers or percentages) and a set of basic names.
 */
export function parseColor(input: string): Rgba {
  if (typeof input !== 'string') throw new TypeError(`expected a color string, got ${String(input)}`);
  const s = input.trim().toLowerCase();

  const named = NAMED_COLORS[s];
  if (named) return named;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) {
      throw new TypeError(`invalid hex color "${input}"`);
    }
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }

  const m = /^rgba?\((.*)\)$/.exec(s);
  if (m) {
    const parts = m[1].replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter((p) => p !== '' && p !== '/');
    if (parts.length !== 3 && parts.length !== 4) throw new TypeError(`invalid rgb() color "${input}"`);
    const r = parseChannel(parts[0], 255);
    const g = parseChannel(parts[1], 255);
    const b = parseChannel(parts[2], 255);
    const a = parts.length === 4 ? parseChannel(parts[3], 1) : 1;
    return [r, g, b, a];
  }

  throw new TypeError(`unsupported color "${input}"`);
}

const hex2 = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** Format a color as `#rrggbb` when opaque, otherwise `rgba(r, g, b, a)`. */
export function formatColor(c: Rgba): string {
  const a = round(clamp(c[3], 0, 1), 3);
  if (a >= 1) return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
  const ch = (n: number): number => Math.round(clamp(n, 0, 255));
  return `rgba(${ch(c[0])}, ${ch(c[1])}, ${ch(c[2])}, ${a})`;
}

/**
 * Colors. Interpolation happens in sRGB with **premultiplied alpha**, so
 * fading to `transparent` does not pass through a dark fringe.
 */
export const colorType: ValueType<string, Rgba> = {
  name: 'color',
  parse: parseColor,
  lerp(a, b, t) {
    const alpha = clamp(lerp(a[3], b[3], t), 0, 1);
    if (alpha === 0) return [0, 0, 0, 0];
    const ch = (i: number): number => clamp(lerp(a[i] * a[3], b[i] * b[3], t) / alpha, 0, 255);
    return [ch(0), ch(1), ch(2), alpha];
  },
  format: formatColor,
};

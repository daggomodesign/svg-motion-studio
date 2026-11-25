/**
 * Length units and canvas normalization.
 *
 * Drawing tools write the root `<svg>` in whatever unit the document was set
 * to: CorelDRAW and Inkscape default to millimetres, Illustrator to points,
 * web exports to pixels. The `viewBox` is the authoritative coordinate system,
 * so the job here is to keep it and make `width` / `height` agree with it.
 */

/** CSS pixels per unit, at the 96 dpi reference of the CSS specification. */
export const PX_PER_UNIT: Readonly<Record<string, number>> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  q: 96 / 25.4 / 4,
};

/** A length as written: a number plus its unit (`px` when omitted). */
export interface Length {
  /** Numeric part. */
  readonly value: number;
  /** Lower-case unit, `px` when the source had none. */
  readonly unit: string;
}

const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z%]*)\s*$/;

/** Parse a length such as `210mm`, `72pt` or `512`. Returns `undefined` for `%`, `em` and junk. */
export function parseLength(input: string | undefined): Length | undefined {
  if (input === undefined) return undefined;
  const m = LENGTH.exec(input);
  if (m === null) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = (m[2] === '' ? 'px' : m[2].toLowerCase());
  if (unit === '%' || unit === 'em' || unit === 'ex' || unit === 'rem') return undefined;
  return { value, unit };
}

/** Convert a length to CSS pixels. Unknown units are treated as pixels. */
export function toPx(length: Length): number {
  return length.value * (PX_PER_UNIT[length.unit] ?? 1);
}

/** True when the unit is one we can convert exactly. */
export function isKnownUnit(unit: string): boolean {
  return Object.prototype.hasOwnProperty.call(PX_PER_UNIT, unit);
}

/** Round to 4 decimals, normalizing `-0`. */
export function tidy(n: number, decimals = 4): number {
  const f = Math.pow(10, decimals);
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
}

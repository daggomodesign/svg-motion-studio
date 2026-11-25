/**
 * 2D affine transforms: parse the SVG `transform` attribute, compose
 * matrices and map points.
 *
 * Used for bounding boxes, transform origins and the editor's selection
 * outlines. Pure math — no DOM.
 */

/** Affine matrix `[a, b, c, d, e, f]`, the same order as SVG's `matrix()`. */
export type Matrix = readonly [number, number, number, number, number, number];

/** The identity matrix. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Compose two matrices: the result applies `n` first, then `m`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Map a point through a matrix. */
export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** True when the matrix leaves every point where it is. */
export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** Build the matrix of one transform primitive. */
function primitive(name: string, args: readonly number[]): Matrix {
  const a = (i: number, fallback = 0): number => (Number.isFinite(args[i]) ? args[i] : fallback);
  switch (name) {
    case 'matrix':
      return [a(0, 1), a(1), a(2), a(3, 1), a(4), a(5)];
    case 'translate':
      return [1, 0, 0, 1, a(0), a(1)];
    case 'scale': {
      const sx = a(0, 1);
      return [sx, 0, 0, args.length > 1 ? a(1, 1) : sx, 0, 0];
    }
    case 'rotate': {
      const rad = (a(0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
      if (args.length < 3) return rot;
      const cx = a(1);
      const cy = a(2);
      return multiply(multiply([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
    }
    case 'skewX':
      return [1, 0, Math.tan((a(0) * Math.PI) / 180), 1, 0, 0];
    case 'skewY':
      return [1, Math.tan((a(0) * Math.PI) / 180), 0, 1, 0, 0];
    default:
      return IDENTITY;
  }
}

/**
 * Parse an SVG `transform` attribute into a single matrix.
 * Unknown primitives are ignored; a missing or empty value is the identity.
 */
export function parseTransform(input: string | undefined): Matrix {
  if (input === undefined || input.trim() === '') return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const args = (match[2].match(NUMBER) ?? []).map(Number);
    m = multiply(m, primitive(match[1], args));
  }
  return m;
}

/** Format a matrix as a `matrix(...)` attribute value. */
export function formatMatrix(m: Matrix, decimals = 4): string {
  const f = (n: number): string => {
    const r = Number(n.toFixed(decimals));
    return String(r === 0 ? 0 : r);
  };
  return `matrix(${m.map(f).join(' ')})`;
}

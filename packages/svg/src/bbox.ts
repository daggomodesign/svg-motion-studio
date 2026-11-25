/**
 * Bounding boxes of SVG elements, in local and in root coordinates.
 *
 * Curves and arcs are sampled, so a box is a tight, deterministic
 * approximation rather than an exact analytic bound. That is what the editor
 * needs for selection outlines and what animation presets need to rotate an
 * element around its own centre.
 */

import { parsePath } from '@svg-motion-studio/core';
import { getAttr } from './dom.js';
import { applyMatrix, IDENTITY, multiply, parseTransform, type Matrix } from './transform.js';
import { localName, type SvgDocument, type SvgElement } from './xml.js';

/** An axis-aligned rectangle. */
export interface Box {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width (never negative). */
  readonly width: number;
  /** Height (never negative). */
  readonly height: number;
}

/** Samples per curve segment when bounding a path. */
const CURVE_STEPS = 12;

const num = (el: SvgElement, name: string, fallback = 0): number => {
  const raw = getAttr(el, name);
  if (raw === undefined) return fallback;
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
};

/** Union of two boxes; `undefined` acts as the empty box. */
export function unionBox(a: Box | undefined, b: Box | undefined): Box | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Map a box through a matrix (the four corners, then the enclosing rectangle). */
export function transformBox(box: Box, m: Matrix): Box {
  const corners = [
    applyMatrix(m, box.x, box.y),
    applyMatrix(m, box.x + box.width, box.y),
    applyMatrix(m, box.x, box.y + box.height),
    applyMatrix(m, box.x + box.width, box.y + box.height),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Centre of a box. */
export function boxCenter(box: Box): [number, number] {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Points of a cubic Bézier segment, excluding the start point. */
function cubicPoints(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3]);
  }
  return out;
}

/** Points of a quadratic Bézier segment, excluding the start point. */
function quadPoints(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push([u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2]);
  }
  return out;
}

/**
 * Points of an elliptical arc segment, excluding the start point.
 * Implements the endpoint → centre conversion of the SVG specification.
 */
function arcPoints(
  x1: number, y1: number, rx: number, ry: number, rotDeg: number,
  largeArc: number, sweep: number, x2: number, y2: number,
): [number, number][] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  let rxa = Math.abs(rx);
  let rya = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxa *= s;
    rya *= s;
  }
  const den = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p;
  const numer = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p;
  const sign = largeArc === sweep ? -1 : 1;
  const co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, numer / den));
  const cxp = (co * rxa * y1p) / rya;
  const cyp = (-co * rya * x1p) / rxa;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const ux = (x1p - cxp) / rxa;
  const uy = (y1p - cyp) / rya;
  const vx = (-x1p - cxp) / rxa;
  const vy = (-y1p - cyp) / rya;
  const theta1 = angle(1, 0, ux, uy);
  let dtheta = angle(ux, uy, vx, vy);
  if (sweep === 0 && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep === 1 && dtheta < 0) dtheta += 2 * Math.PI;

  const out: [number, number][] = [];
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = theta1 + (dtheta * i) / CURVE_STEPS;
    out.push([
      cx + rxa * Math.cos(t) * cosP - rya * Math.sin(t) * sinP,
      cy + rxa * Math.cos(t) * sinP + rya * Math.sin(t) * cosP,
    ]);
  }
  return out;
}

/** Bounding box of a `points` attribute (polyline / polygon). */
function pointsBox(raw: string | undefined): Box | undefined {
  if (raw === undefined) return undefined;
  const nums = (raw.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  if (nums.length < 2) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounding box of path data, sampling every curve and arc segment. */
function pathBox(d: string | undefined): Box | undefined {
  if (d === undefined || d.trim() === '') return undefined;
  let commands;
  try {
    commands = parsePath(d);
  } catch {
    return undefined;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const cmd of commands) {
    // `Z` carries no arguments, so widen to a plain number tuple here and let
    // the switch below decide how many of them each command actually uses.
    const v = cmd.v as readonly number[];
    switch (cmd.c) {
      case 'M':
      case 'L':
        add(v[0], v[1]);
        cx = v[0];
        cy = v[1];
        if (cmd.c === 'M') {
          sx = cx;
          sy = cy;
        }
        break;
      case 'C':
        for (const p of cubicPoints(cx, cy, v[0], v[1], v[2], v[3], v[4], v[5])) add(p[0], p[1]);
        cx = v[4];
        cy = v[5];
        break;
      case 'Q':
        for (const p of quadPoints(cx, cy, v[0], v[1], v[2], v[3])) add(p[0], p[1]);
        cx = v[2];
        cy = v[3];
        break;
      case 'A':
        for (const p of arcPoints(cx, cy, v[0], v[1], v[2], v[3], v[4], v[5], v[6])) add(p[0], p[1]);
        cx = v[5];
        cy = v[6];
        break;
      case 'Z':
        cx = sx;
        cy = sy;
        break;
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Bounding box of an element in its own user space, before its own
 * `transform`. Containers (`g`, `svg`, `a`, `switch`) return `undefined` —
 * use {@link documentBBoxes} to get their union.
 */
export function localBBox(el: SvgElement): Box | undefined {
  switch (localName(el.name)) {
    case 'rect':
    case 'image':
    case 'foreignObject':
      return { x: num(el, 'x'), y: num(el, 'y'), width: num(el, 'width'), height: num(el, 'height') };
    case 'circle': {
      const r = num(el, 'r');
      return { x: num(el, 'cx') - r, y: num(el, 'cy') - r, width: 2 * r, height: 2 * r };
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      return { x: num(el, 'cx') - rx, y: num(el, 'cy') - ry, width: 2 * rx, height: 2 * ry };
    }
    case 'line': {
      const x1 = num(el, 'x1');
      const y1 = num(el, 'y1');
      const x2 = num(el, 'x2');
      const y2 = num(el, 'y2');
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    }
    case 'polyline':
    case 'polygon':
      return pointsBox(getAttr(el, 'points'));
    case 'path':
      return pathBox(getAttr(el, 'd'));
    case 'text': {
      // Text metrics need a font engine; approximate from the font size and the
      // number of characters so the editor still has something to draw.
      const size = num(el, 'font-size', 16);
      const chars = el.children.reduce((n, c) => n + (c.type === 'text' ? c.raw.length : 0), 0);
      const x = num(el, 'x');
      const y = num(el, 'y');
      return { x, y: y - size, width: Math.max(size * 0.5, chars * size * 0.5), height: size * 1.2 };
    }
    case 'use':
      return { x: num(el, 'x'), y: num(el, 'y'), width: num(el, 'width'), height: num(el, 'height') };
    default:
      return undefined;
  }
}

/**
 * Bounding box of every element in root coordinates, accounting for the
 * `transform` of the element and of all its ancestors.
 */
export function documentBBoxes(doc: SvgDocument): Map<SvgElement, Box> {
  const out = new Map<SvgElement, Box>();
  const visit = (el: SvgElement, parent: Matrix): Box | undefined => {
    const m = multiply(parent, parseTransform(getAttr(el, 'transform')));
    const own = localBBox(el);
    let box = own === undefined ? undefined : transformBox(own, m);
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      box = unionBox(box, visit(child, m));
    }
    if (box !== undefined) out.set(el, box);
    return box;
  };
  visit(doc.root, IDENTITY);
  return out;
}

/**
 * Path parsing, normalization and morphing.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { formatPath, parsePath, pathsCompatible, pathType, sampleTrack, type Track } from '../src/index.js';

const norm = (d: string): string => formatPath(parsePath(d));

test('relative commands and H/V normalize to absolute M/L', () => {
  assert.equal(norm('m10 10 h20 v20 h-20 z'), 'M10 10 L30 10 L30 30 L10 30 Z');
});

test('implicit lineto after moveto and compact number syntax', () => {
  assert.equal(norm('M0,0 10,0 10-5.5.5.5'), 'M0 0 L10 0 L10 -5.5 L0.5 0.5');
});

test('S and T expand into C and Q with reflected control points', () => {
  assert.equal(norm('M0 0 C0 10 10 10 10 0 S20 -10 20 0'), 'M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0');
  assert.equal(norm('M0 0 Q5 10 10 0 T20 0'), 'M0 0 Q5 10 10 0 Q15 -10 20 0');
  // S without a preceding C uses the current point as first control point.
  assert.equal(norm('M0 0 S5 5 10 0'), 'M0 0 C0 0 5 5 10 0');
});

test('arc flags may be written without separators', () => {
  assert.equal(norm('M0 0 a10 10 0 0110 10'), 'M0 0 A10 10 0 0 1 10 10');
});

test('Z returns the current point to the subpath start', () => {
  assert.equal(norm('M5 5 L10 5 Z l1 1'), 'M5 5 L10 5 Z L6 6');
});

test('malformed path data throws', () => {
  assert.throws(() => parsePath(''), TypeError);
  assert.throws(() => parsePath('L0 0'), TypeError);
  assert.throws(() => parsePath('M0'), TypeError);
  assert.throws(() => parsePath('M0 0 X1 1'), TypeError);
  assert.throws(() => parsePath('M0 0 A1 1 0 2 0 5 5'), TypeError);
});

test('paths with the same structure morph, others are incompatible', () => {
  const square = 'M0 0 H10 V10 H0 Z';
  const diamond = 'M5 -5 L15 5 L5 15 L-5 5 Z';
  assert.ok(pathsCompatible(parsePath(square), parsePath(diamond)));
  assert.ok(!pathsCompatible(parsePath(square), parsePath('M0 0 L10 10')));

  const track: Track<string> = [
    { t: 0, value: square },
    { t: 1, value: diamond },
  ];
  assert.equal(sampleTrack(track, 0.5, pathType), 'M2.5 -2.5 L12.5 2.5 L7.5 12.5 L-2.5 7.5 Z');
});

test('arc flags switch at the midpoint of a morph', () => {
  const track: Track<string> = [
    { t: 0, value: 'M0 0 A5 5 0 0 0 10 0' },
    { t: 1, value: 'M0 0 A5 5 0 1 1 10 0' },
  ];
  assert.equal(sampleTrack(track, 0.25, pathType), 'M0 0 A5 5 0 0 0 10 0');
  assert.equal(sampleTrack(track, 0.75, pathType), 'M0 0 A5 5 0 1 1 10 0');
});

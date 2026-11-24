/**
 * Kernel tests: easing curves, interpolation and track sampling.
 * Run with: npm test
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  compileTrack,
  cubicBezier,
  easingFn,
  lerp,
  sampleCompiled,
  sampleTrack,
  type Track,
} from '../src/index.js';

test('lerp interpolates and extrapolates linearly', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(2, 4, 0), 2);
  assert.equal(lerp(2, 4, 1), 4);
});

test('linear easing is the identity', () => {
  const f = easingFn('linear');
  assert.equal(f(0), 0);
  assert.equal(f(0.25), 0.25);
  assert.equal(f(1), 1);
});

test('cubicBezier endpoints are exact and midpoint is inside', () => {
  const f = cubicBezier(0.42, 0, 0.58, 1);
  assert.equal(f(0), 0);
  assert.equal(f(1), 1);
  assert.ok(f(0.5) > 0 && f(0.5) < 1);
});

test('degenerate cubicBezier collapses to linear', () => {
  const f = cubicBezier(0, 0, 1, 1);
  assert.equal(f(0.5), 0.5);
});

test('sampleTrack clamps outside the keyframe range', () => {
  const track = [
    { t: 0, value: 10 },
    { t: 1, value: 20 },
  ];
  assert.equal(sampleTrack(track, -5), 10);
  assert.equal(sampleTrack(track, 99), 20);
  assert.equal(sampleTrack(track, 0.5), 15);
});

test('segment easing is taken from the arriving keyframe', () => {
  const track: Track = [
    { t: 0, value: 0 },
    { t: 1, value: 100, ease: 'step-end' },
  ];
  assert.equal(sampleTrack(track, 0.5), 0);
  assert.equal(sampleTrack(track, 1), 100);
});

test('compileTrack sorts unsorted keyframes and precomputes bounds', () => {
  const track = [
    { t: 2, value: 4 },
    { t: 0, value: 0 },
    { t: 1, value: 100 },
  ];
  const ct = compileTrack(track);
  assert.equal(ct.start, 0);
  assert.equal(ct.end, 2);
  assert.equal(ct.duration, 2);
  assert.equal(sampleCompiled(ct, 0.5), 50);
  assert.equal(sampleCompiled(ct, 1.5), 52);
  assert.equal(sampleTrack(track, 2), 4);
});

test('degenerate tracks: empty and single-keyframe', () => {
  assert.equal(sampleTrack([], 1), 0);
  assert.equal(sampleTrack([{ t: 3, value: 7 }], 0), 7);
  assert.equal(sampleTrack([{ t: 3, value: 7 }], 10), 7);
});

test('bounce and elastic reach 1 at the end and stay bounded', () => {
  const b = easingFn('bounce-out');
  const e = easingFn('elastic-out');
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    assert.ok(b(x) >= -1e-9 && b(x) <= 1 + 1e-9, `bounce at x=${x}`);
    assert.ok(e(x) >= -0.5 && e(x) <= 1.5, `elastic at x=${x}`);
  }
  assert.ok(Math.abs(b(1) - 1) < 1e-9);
  assert.ok(Math.abs(e(1) - 1) < 1e-9);
});

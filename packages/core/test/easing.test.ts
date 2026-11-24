/**
 * Easing details beyond the kernel smoke tests.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { compileTrack, cubicBezier, EASING_NAMES, easingFn, isEasing } from '../src/index.js';

test('every named easing maps 1 to 1', () => {
  for (const name of EASING_NAMES) {
    assert.ok(Math.abs(easingFn(name)(1) - 1) < 1e-9, name);
  }
});

test('cubicBezier matches the CSS ease-in-out midpoint symmetry', () => {
  const f = cubicBezier(0.42, 0, 0.58, 1);
  assert.ok(Math.abs(f(0.5) - 0.5) < 1e-6);
  assert.ok(Math.abs(f(0.25) + f(0.75) - 1) < 1e-6);
});

test('cubicBezier is monotonic for a steep curve', () => {
  const f = cubicBezier(0.9, 0, 0.1, 1);
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const y = f(i / 100);
    assert.ok(y >= prev - 1e-9, `x=${i / 100}`);
    prev = y;
  }
});

test('cubicBezier rejects x control points outside [0, 1]', () => {
  assert.throws(() => cubicBezier(-0.1, 0, 0.5, 1), RangeError);
  assert.throws(() => cubicBezier(0.1, 0, 1.5, 1), RangeError);
});

test('isEasing validates names and cubic-bezier descriptors', () => {
  assert.ok(isEasing('ease-out-back'));
  assert.ok(isEasing({ cubicBezier: [0.1, -2, 0.9, 3] }));
  assert.ok(!isEasing('ease-sideways'));
  assert.ok(!isEasing({ cubicBezier: [2, 0, 0.5, 1] }));
  assert.ok(!isEasing({ cubicBezier: [0, 0, 1] }));
});

test('compileTrack resolves easing curves once, not per sample', () => {
  const ct = compileTrack([
    { t: 0, value: 0 },
    { t: 1, value: 1, ease: { cubicBezier: [0.3, 0.1, 0.3, 1] } },
  ]);
  assert.equal(ct.eases.length, 2);
  assert.equal(typeof ct.eases[1], 'function');
});

test('step-start jumps at the segment start, step-end at its end', () => {
  assert.equal(easingFn('step-start')(0.01), 1);
  assert.equal(easingFn('step-end')(0.99), 0);
  assert.equal(easingFn('step-end')(1), 1);
});

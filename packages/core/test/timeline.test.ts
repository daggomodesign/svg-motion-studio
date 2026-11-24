/**
 * Timeline math: loops, frame grids, formatting.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { formatTime, frameCount, frameTimes, localTime, snapToFrame, totalLength } from '../src/index.js';

test('once plays through and holds the end', () => {
  const p = { duration: 2, loop: 'once' as const };
  assert.equal(localTime(-1, p), 0);
  assert.equal(localTime(1.5, p), 1.5);
  assert.equal(localTime(5, p), 2);
});

test('loop wraps and stops after the last iteration', () => {
  const p = { duration: 2, loop: 'loop' as const, iterations: 2 };
  assert.equal(localTime(2.5, p), 0.5);
  assert.equal(localTime(3.9, p), 3.9 - 2);
  assert.equal(localTime(10, p), 2);
  assert.equal(localTime(1e6 + 0.25, { duration: 2, loop: 'loop' }), 0.25);
});

test('ping-pong reverses every other pass', () => {
  const p = { duration: 2, loop: 'ping-pong' as const };
  assert.equal(localTime(0.5, p), 0.5);
  assert.equal(localTime(2.5, p), 1.5);
  assert.equal(localTime(4.5, p), 0.5);
  assert.equal(localTime(10, { ...p, iterations: 2 }), 0);
  assert.equal(localTime(10, { ...p, iterations: 3 }), 2);
});

test('totalLength accounts for iterations', () => {
  assert.equal(totalLength({ duration: 2, loop: 'once' }), 2);
  assert.equal(totalLength({ duration: 2, loop: 'loop', iterations: 3 }), 6);
  assert.equal(totalLength({ duration: 2, loop: 'loop' }), Infinity);
});

test('frame grid helpers', () => {
  assert.equal(frameCount(2, 30), 60);
  assert.equal(frameCount(0.01, 30), 1);
  assert.equal(frameCount(0, 30), 0);
  assert.deepEqual(frameTimes(0.1, 30), [0, 1 / 30, 2 / 30]);
  assert.deepEqual(frameTimes(0.1, 30, true), [0, 1 / 30, 2 / 30, 0.1]);
  assert.equal(snapToFrame(0.51, 10), 0.5);
  assert.throws(() => frameCount(1, 0), RangeError);
});

test('formatTime renders mm:ss.mmm', () => {
  assert.equal(formatTime(0), '00:00.000');
  assert.equal(formatTime(62.5), '01:02.500');
  assert.equal(formatTime(-3), '00:00.000');
});

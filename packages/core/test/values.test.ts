/**
 * Value types: numbers, vectors and colors.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  colorType,
  compileTrack,
  formatColor,
  parseColor,
  sampleCompiled,
  sampleTrack,
  vectorType,
  type Track,
} from '../src/index.js';

test('parseColor reads hex, rgb() and names', () => {
  assert.deepEqual(parseColor('#f00'), [255, 0, 0, 1]);
  assert.deepEqual(parseColor('#00ff0080'), [0, 255, 0, 128 / 255]);
  assert.deepEqual(parseColor('rgb(10, 20, 30)'), [10, 20, 30, 1]);
  assert.deepEqual(parseColor('rgba(10,20,30,0.5)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColor('rgb(100% 0% 0% / 50%)'), [255, 0, 0, 0.5]);
  assert.deepEqual(parseColor(' White '), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
});

test('parseColor rejects garbage', () => {
  assert.throws(() => parseColor('#12'), TypeError);
  assert.throws(() => parseColor('hsl(0 100% 50%)'), TypeError);
  assert.throws(() => parseColor('rgb(1, 2)'), TypeError);
});

test('formatColor emits hex when opaque and rgba() otherwise', () => {
  assert.equal(formatColor([255, 128, 0, 1]), '#ff8000');
  assert.equal(formatColor([255, 0, 0, 0.5]), 'rgba(255, 0, 0, 0.5)');
  assert.equal(formatColor([300, -5, 0, 1]), '#ff0000');
});

test('color tracks interpolate and clamp overshoot', () => {
  const track: Track<string> = [
    { t: 0, value: '#000000' },
    { t: 1, value: '#ffffff' },
  ];
  assert.equal(sampleTrack(track, 0.5, colorType), '#808080');
  const back: Track<string> = [
    { t: 0, value: '#000000' },
    { t: 1, value: '#ffffff', ease: 'ease-in-back' },
  ];
  // ease-in-back dips below 0 early on: channels must clamp, not wrap.
  assert.equal(sampleTrack(back, 0.2, colorType), '#000000');
});

test('fading to transparent keeps the hue (premultiplied alpha)', () => {
  const track: Track<string> = [
    { t: 0, value: '#ff0000' },
    { t: 1, value: 'transparent' },
  ];
  assert.equal(sampleTrack(track, 0.5, colorType), 'rgba(255, 0, 0, 0.5)');
  assert.equal(sampleTrack(track, 1, colorType), 'rgba(0, 0, 0, 0)');
});

test('vector tracks interpolate per component', () => {
  const ct = compileTrack(
    [
      { t: 0, value: [0, 100] },
      { t: 2, value: [10, 0] },
    ],
    vectorType,
  );
  assert.deepEqual(sampleCompiled(ct, 1), [5, 50]);
});

test('vector keyframes of different lengths are rejected at compile time', () => {
  assert.throws(
    () =>
      compileTrack(
        [
          { t: 0, value: [0, 0] },
          { t: 1, value: [1, 2, 3] },
        ],
        vectorType,
      ),
    /not compatible/,
  );
});

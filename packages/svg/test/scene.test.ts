import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScene } from '@svg-motion-studio/core';
import { bindScene, parseSvg, readCanvas, sceneFromSvg } from '../src/index.js';

test('readCanvas prefers the viewBox, then width/height, then 300×150', () => {
  assert.deepEqual(readCanvas(parseSvg('<svg viewBox="-10 -10 400 200" width="50"/>')), {
    width: 400,
    height: 200,
    viewBox: [-10, -10, 400, 200],
  });
  assert.deepEqual(readCanvas(parseSvg('<svg width="64px" height="32"/>')), { width: 64, height: 32, viewBox: [0, 0, 64, 32] });
  assert.deepEqual(readCanvas(parseSvg('<svg width="100%"/>')), { width: 300, height: 150, viewBox: [0, 0, 300, 150] });
});

test('sceneFromSvg takes the canvas and keeps the markup as source', () => {
  const markup = '<svg viewBox="0 0 120 80"><rect id="r"/></svg>';
  const scene = sceneFromSvg(markup, { duration: 5 });
  assert.equal(scene.width, 120);
  assert.equal(scene.height, 80);
  assert.equal(scene.duration, 5);
  assert.equal(scene.source, markup);
});

test('bindScene resolves targets and warns about the rest', () => {
  const doc = parseSvg('<svg><rect id="box"/><path id="p" d="M0 0"/></svg>');
  const scene = createScene({
    animators: [
      { id: 'a', target: 'box', property: 'opacity', keyframes: [{ t: 0, value: 1 }] },
      { id: 'b', target: 'ghost', property: 'opacity', keyframes: [{ t: 0, value: 1 }] },
      { id: 'c', target: 'box', property: 'd', keyframes: [{ t: 0, value: 'M0 0' }] },
      { id: 'd', target: 'p', property: 'fill', trigger: { type: 'click', target: 'nope' }, keyframes: [{ t: 0, value: 'red' }] },
    ],
  });
  const { elements, issues } = bindScene(doc, scene);
  assert.deepEqual([...elements.keys()], ['a', 'c', 'd']);
  assert.deepEqual(
    issues.map((i) => i.path),
    ['animators/1/target', 'animators/2/property', 'animators/3/trigger/target'],
  );
  assert.ok(issues.every((i) => i.severity === 'warning'));
});

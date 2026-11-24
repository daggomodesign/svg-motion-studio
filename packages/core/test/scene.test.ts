/**
 * Scene model: validation, compilation and evaluation.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { compileScene, createScene, evaluateScene, SceneError, validateScene, type Scene } from '../src/index.js';

const demo: Scene = createScene({
  duration: 2,
  fps: 30,
  loop: 'once',
  animators: [
    {
      id: 'spin',
      target: 'logo',
      property: 'rotate',
      keyframes: [
        { t: 0, value: 0 },
        { t: 2, value: 360 },
      ],
    },
    {
      id: 'tint',
      target: 'logo',
      property: 'fill',
      keyframes: [
        { t: 0, value: '#000000' },
        { t: 1, value: '#ffffff', ease: 'step-end' },
      ],
    },
    {
      id: 'slide',
      target: 'dot',
      property: 'translate',
      trigger: { type: 'autoplay', delay: 1 },
      keyframes: [
        { t: 0, value: [0, 0] },
        { t: 1, value: [100, 0] },
      ],
    },
    {
      id: 'pop',
      target: 'dot',
      property: 'opacity',
      trigger: { type: 'click' },
      keyframes: [
        { t: 0, value: 1 },
        { t: 0.5, value: 0 },
      ],
    },
  ],
});

test('a well-formed scene validates without issues', () => {
  assert.deepEqual(validateScene(demo), []);
});

test('evaluateScene samples every animator on its own clock', () => {
  const cs = compileScene(demo);
  const f = evaluateScene(cs, 1.5);
  assert.equal(f.logo.rotate, 270);
  assert.equal(f.logo.fill, '#ffffff');
  assert.deepEqual(f.dot.translate, [50, 0]); // started at 1s (delay)
  assert.equal(f.dot.opacity, 1); // click never happened: rest pose

  const clicked = evaluateScene(cs, 1.5, { starts: { pop: 1.25 } });
  assert.equal(clicked.dot.opacity, 0.5);
});

test('scene loop settings apply to each animator clock', () => {
  const cs = compileScene({ ...demo, loop: 'loop' });
  // 2.5s into a 2s loop is 0.5s on the timeline: 360° over 2s → 90°.
  assert.equal(evaluateScene(cs, 2.5).logo.rotate, 90);
});

test('disabled animators are not evaluated', () => {
  const scene: Scene = {
    ...demo,
    animators: demo.animators.map((a) => (a.id === 'spin' ? { ...a, enabled: false } : a)),
  };
  assert.equal(evaluateScene(compileScene(scene), 1).logo.rotate, undefined);
});

test('validateScene reports precise, located errors', () => {
  const bad = {
    ...demo,
    fps: 0,
    animators: [
      { id: 'a', target: 'x', property: 'wobble', keyframes: [{ t: 0, value: 1 }] },
      { id: 'a', target: 'x', property: 'fill', keyframes: [{ t: 0, value: 'not-a-color' }] },
      { id: 'b', target: 'x', property: 'translate', keyframes: [{ t: 0, value: [1, 2, 3] }] },
      {
        id: 'c',
        target: 'x',
        property: 'd',
        keyframes: [
          { t: 0, value: 'M0 0 L1 1' },
          { t: 1, value: 'M0 0 L1 1 L2 2' },
        ],
      },
      { id: 'd', target: 'x', property: 'motion', keyframes: [{ t: 0, value: 0 }] },
      { id: 'e', target: 'x', property: 'opacity', keyframes: [{ t: 0, value: 1, ease: 'wiggle' }] },
    ],
  };
  const paths = validateScene(bad)
    .filter((i) => i.severity === 'error')
    .map((i) => i.path);
  assert.deepEqual(paths, [
    'fps',
    'animators/0/property',
    'animators/1/id',
    'animators/1/keyframes/0/value',
    'animators/2/keyframes/0/value',
    'animators/3/keyframes',
    'animators/4/motionPath',
    'animators/5/keyframes/0/ease',
  ]);
});

test('validateScene warns about overlapping animators and late keyframes', () => {
  const scene: Scene = {
    ...demo,
    animators: [
      ...demo.animators,
      { id: 'spin2', target: 'logo', property: 'rotate', keyframes: [{ t: 5, value: 1 }] },
    ],
  };
  const issues = validateScene(scene);
  assert.ok(issues.every((i) => i.severity === 'warning'));
  assert.equal(issues.length, 2);
});

test('compileScene throws SceneError with the issue list', () => {
  try {
    compileScene({ ...demo, duration: -1 });
    assert.fail('expected SceneError');
  } catch (e) {
    assert.ok(e instanceof SceneError);
    assert.equal(e.issues[0].path, 'duration');
  }
});

test('scenes survive a JSON round trip', () => {
  const copy = JSON.parse(JSON.stringify(demo)) as Scene;
  assert.deepEqual(evaluateScene(compileScene(copy), 1.2), evaluateScene(compileScene(demo), 1.2));
});

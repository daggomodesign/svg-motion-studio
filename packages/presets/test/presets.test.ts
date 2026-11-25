import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileScene, validateScene } from '@svg-motion-studio/core';
import { autoAnimate, getPreset, PRESETS, withAutoAnimate } from '../src/index.js';

describe('presets', () => {
  it('exposes every preset with a stable id and a build function', () => {
    assert.ok(PRESETS.length >= 10);
    for (const preset of PRESETS) {
      assert.match(preset.id, /^[a-z-]+$/);
      assert.ok(preset.name.length > 0);
      assert.equal(typeof preset.build, 'function');
      assert.ok(preset.duration > 0);
    }
  });

  it('looks presets up by id', () => {
    assert.equal(getPreset('fade-in')?.name, 'Fade in');
    assert.equal(getPreset('nope'), undefined);
  });

  it('builds animators that compile into a valid scene', () => {
    const animators = PRESETS.flatMap((p) => p.build('el-1', { origin: [10, 20] }));
    const scene = {
      version: 1 as const,
      width: 100,
      height: 100,
      duration: 3,
      fps: 60,
      loop: 'loop' as const,
      animators,
    };
    const issues = validateScene(scene);
    assert.deepEqual(issues.filter((i) => i.severity === 'error'), []);
    const compiled = compileScene(scene);
    assert.ok(compiled.animators.length >= animators.length);
  });

  it('gives every animator a unique id when prefixed', () => {
    const animators = PRESETS.flatMap((p, i) => p.build('el-1', { idPrefix: `p${i}` }));
    const ids = new Set(animators.map((a) => a.id));
    assert.equal(ids.size, animators.length);
  });

  it('honours duration, delay and easing options', () => {
    const [animator] = getPreset('fade-in')!.build('el-1', { duration: 2, delay: 0.5, ease: 'ease-in' });
    assert.equal(animator.keyframes[animator.keyframes.length - 1].t, 2);
    assert.equal(animator.trigger?.type, 'autoplay');
    assert.equal((animator.trigger as { delay?: number }).delay, 0.5);
    assert.equal(animator.keyframes[1].ease, 'ease-in');
  });

  it('adds an origin animator when an origin is given', () => {
    const animators = getPreset('spin')!.build('el-1', { origin: [5, 6] });
    const origin = animators.find((a) => a.property === 'origin');
    assert.ok(origin !== undefined);
    assert.deepEqual(origin.keyframes[0].value, [5, 6]);
  });

  it('draw preset animates stroke-dashoffset', () => {
    const [animator] = getPreset('draw')!.build('el-1', { distance: 500 });
    assert.equal(animator.property, 'stroke-dashoffset');
    assert.equal(animator.keyframes[0].value, 500);
    assert.equal(animator.keyframes[1].value, 0);
  });
});

describe('autoAnimate', () => {
  it('stages entrances and adds an idle', () => {
    const animators = autoAnimate(['a', 'b', 'c'], { stagger: 0.1 });
    assert.ok(animators.length >= 6);
    const delays = animators
      .filter((a) => a.id.startsWith('in'))
      .map((a) => (a.trigger as { delay?: number }).delay ?? 0);
    assert.deepEqual(delays, [0, 0.1, 0.2]);
  });

  it('respects the limit', () => {
    const animators = autoAnimate(Array.from({ length: 50 }, (_, i) => `e${i}`), { limit: 5 });
    const targets = new Set(animators.map((a) => a.target));
    assert.equal(targets.size, 5);
  });

  it('can skip the idle', () => {
    const animators = autoAnimate(['a'], { idle: 'none' });
    assert.ok(animators.every((a) => !a.id.startsWith('idle')));
  });

  it('extends the scene duration so the entrance fits', () => {
    const scene = {
      version: 1 as const,
      width: 100,
      height: 100,
      duration: 1,
      fps: 60,
      loop: 'loop' as const,
      animators: [],
    };
    const animated = withAutoAnimate(scene, ['a', 'b', 'c', 'd'], { stagger: 0.2 });
    assert.ok(animated.duration >= 0.8 + 2.4);
    assert.ok(animated.animators.length > 0);
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileScene, createScene, evaluateScene, SceneError, type Animator, type Scene } from '@svg-motion-studio/core';
import { findById, getAttr, parseSvg, walk, type SvgElement } from '@svg-motion-studio/svg';
import { exportAnimatedSvg, exportCss, exportSmil, planTrack, smilNative, cssNative } from '../src/index.js';

const SOURCE = '<svg viewBox="0 0 100 100"><rect id="box" width="10" height="10"/><circle id="dot" r="5"/></svg>';

const sceneWith = (animators: Animator[], extra: Partial<Scene> = {}): Scene =>
  createScene({ width: 100, height: 100, duration: 2, source: SOURCE, animators, ...extra });

const children = (svg: string, id: string): SvgElement[] => {
  const el = findById(parseSvg(svg), id);
  assert.ok(el, `element ${id}`);
  return el.children.filter((c): c is SvgElement => c.type === 'element');
};

const spin: Animator = {
  id: 'spin',
  target: 'box',
  property: 'rotate',
  keyframes: [{ t: 0, value: 0 }, { t: 2, value: 360, ease: 'ease-in-out' }],
};

test('SMIL: native easing becomes keySplines, loop repeats forever', () => {
  const { svg, warnings } = exportSmil(sceneWith([spin]));
  assert.deepEqual(warnings, []);
  const [anim] = children(svg, 'box');
  assert.equal(anim.name, 'animateTransform');
  assert.equal(getAttr(anim, 'type'), 'rotate');
  assert.equal(getAttr(anim, 'values'), '0 0 0;360 0 0');
  assert.equal(getAttr(anim, 'keyTimes'), '0;1');
  assert.equal(getAttr(anim, 'calcMode'), 'spline');
  assert.equal(getAttr(anim, 'keySplines'), '0.42 0 0.58 1');
  assert.equal(getAttr(anim, 'repeatCount'), 'indefinite');
  assert.equal(getAttr(anim, 'additive'), 'sum');
  assert.equal(getAttr(parseSvg(svg).root, 'xmlns'), 'http://www.w3.org/2000/svg');
});

test('baked easings match evaluateScene at every exported key time', () => {
  const drop: Animator = { id: 'drop', target: 'dot', property: 'cy', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 90, ease: 'bounce-out' }] };
  const scene = sceneWith([drop], { loop: 'once' });
  const compiled = compileScene(scene);
  const [anim] = children(exportSmil(scene).svg, 'dot');
  assert.equal(getAttr(anim, 'calcMode'), 'linear');
  assert.equal(getAttr(anim, 'repeatCount'), undefined); // once
  assert.equal(getAttr(anim, 'fill'), 'freeze');
  const times = (getAttr(anim, 'keyTimes') ?? '').split(';').map(Number);
  const values = (getAttr(anim, 'values') ?? '').split(';').map(Number);
  assert.ok(times.length > 60, 'baked at 60 fps');
  times.forEach((k, i) => {
    const expected = evaluateScene(compiled, k * 2).dot?.cy as number;
    assert.ok(Math.abs(values[i] - expected) < 0.01, `t=${k * 2}: ${values[i]} vs ${expected}`);
  });
});

test('holds before the first and after the last keyframe; clips past the end', () => {
  const compiled = compileScene(
    sceneWith([{ id: 'o', target: 'box', property: 'opacity', keyframes: [{ t: 0.5, value: 0 }, { t: 3, value: 1 }] }]),
  );
  const points = planTrack(compiled.animators[0], 2, 4, smilNative);
  assert.deepEqual(points[0], { t: 0, value: 0, ease: 'linear' });
  assert.deepEqual(points[1], { t: 0.5, value: 0, ease: 'linear' });
  const last = points[points.length - 1];
  assert.equal(last.t, 2);
  assert.equal(last.value, 0.6); // 1.5 s of 2.5 s
});

test('steps become instant jumps in SMIL and steps() in CSS', () => {
  const blink: Animator = { id: 'blink', target: 'box', property: 'opacity', keyframes: [{ t: 0, value: 1 }, { t: 1, value: 0, ease: 'step-end' }] };
  const compiled = compileScene(sceneWith([blink]));
  assert.deepEqual(
    planTrack(compiled.animators[0], 2, 60, smilNative).map((p) => [p.t, p.value]),
    [[0, 1], [1, 1], [1, 0], [2, 0]],
  );
  const css = exportCss(sceneWith([blink])).svg;
  assert.match(css, /0% \{ opacity: 1; animation-timing-function: steps\(1, jump-end\); \}/);
});

test('ping-pong: SMIL mirrors the pass with reversed curves, CSS alternates', () => {
  const scene = sceneWith([spin], { loop: 'ping-pong', iterations: 4 });
  const [anim] = children(exportSmil(scene).svg, 'box');
  assert.equal(getAttr(anim, 'dur'), '4s');
  assert.equal(getAttr(anim, 'repeatCount'), '2');
  assert.equal(getAttr(anim, 'keyTimes'), '0;0.5;1');
  assert.equal(getAttr(anim, 'keySplines'), '0.42 0 0.58 1;0.42 0 0.58 1'); // ease-in-out is symmetric
  assert.match(exportCss(scene).svg, /sms-spin 2s linear 0s 4 alternate both/);
});

test('triggers: SMIL listens on events, CSS pauses with warnings', () => {
  const pop: Animator = {
    id: 'pop',
    target: 'dot',
    property: 'fill',
    trigger: { type: 'click' },
    keyframes: [{ t: 0, value: '#ff0000' }, { t: 1, value: '#0000ff' }],
  };
  const remote: Animator = { ...spin, trigger: { type: 'hover', target: 'dot' } };
  const delayed: Animator = { id: 'fade', target: 'box', property: 'opacity', trigger: { type: 'autoplay', delay: 0.5 }, keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1 }] };
  const scene = sceneWith([pop, remote, delayed]);

  const smil = exportSmil(scene);
  const [set, animate] = children(smil.svg, 'dot');
  assert.equal(set.name, 'set'); // rests on the first keyframe until clicked
  assert.equal(getAttr(set, 'to'), '#ff0000');
  assert.equal(getAttr(animate, 'begin'), 'click');
  const box = children(smil.svg, 'box');
  assert.equal(getAttr(box[0], 'begin'), 'dot.mouseover');
  assert.equal(getAttr(box[2], 'begin'), '0.5s');

  const css = exportCss(scene);
  assert.match(css.svg, /#dot \{ animation: sms-pop 2s linear 0s infinite normal both; animation-play-state: paused; \}/);
  assert.match(css.svg, /sms-fade 2s linear 0.5s infinite normal both/);
  assert.deepEqual(
    css.warnings.map((w) => w.path),
    ['animators/0/trigger', 'animators/1/trigger'],
  );
});

test('transforms compose translate · rotate · T(o) scale T(-o) around the origin', () => {
  const scene = sceneWith([
    { id: 'o', target: 'box', property: 'origin', keyframes: [{ t: 0, value: [5, 5] }] },
    { id: 's', target: 'box', property: 'scale', keyframes: [{ t: 0, value: [1, 1] }, { t: 1, value: [2, 2] }] },
    { id: 'm', target: 'box', property: 'translate', keyframes: [{ t: 0, value: [0, 0] }, { t: 1, value: [10, 0] }] },
    spin,
  ]);
  const types = children(exportSmil(scene).svg, 'box').map((el) => `${getAttr(el, 'type')}:${getAttr(el, 'values')?.split(';')[0]}`);
  assert.deepEqual(types, ['translate:0 0', 'rotate:0 5 5', 'translate:5 5', 'scale:1 1', 'translate:-5 -5']);

  const css = exportCss(scene).svg;
  assert.match(css, /#box \{ transform-box: view-box; transform-origin: 5px 5px; animation: sms-s .*, sms-m .*, sms-spin /);
  assert.doesNotMatch(css, /@keyframes sms-o/); // constant origin is static
});

test('blur gets a filter in SMIL and filter: blur() in CSS', () => {
  const blur: Animator = { id: 'b', target: 'box', property: 'blur', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 4 }] };
  const smil = exportSmil(sceneWith([blur])).svg;
  const doc = parseSvg(smil);
  assert.equal(getAttr(findById(doc, 'box') as SvgElement, 'filter'), 'url(#sms-blur-b)');
  const filter = findById(doc, 'sms-blur-b');
  assert.ok(filter);
  let animated = '';
  walk(filter, (el) => {
    if (el.name === 'animate') animated = getAttr(el, 'attributeName') ?? '';
  });
  assert.equal(animated, 'stdDeviation');
  assert.match(exportCss(sceneWith([blur])).svg, /100% \{ filter: blur\(4px\); \}/);
});

test('motion paths: animateMotion keyPoints and CSS offset-distance', () => {
  const motion: Animator = {
    id: 'mv',
    target: 'dot',
    property: 'motion',
    motionPath: 'M0 0 L100 0',
    keyframes: [{ t: 0, value: 0 }, { t: 2, value: 1 }],
  };
  const [anim] = children(exportSmil(sceneWith([motion])).svg, 'dot');
  assert.equal(anim.name, 'animateMotion');
  assert.equal(getAttr(anim, 'path'), 'M0 0 L100 0');
  assert.equal(getAttr(anim, 'keyPoints'), '0;1');
  const css = exportCss(sceneWith([motion])).svg;
  assert.match(css, /offset-path: path\("M0 0 L100 0"\); offset-rotate: 0deg/);
  assert.match(css, /100% \{ offset-distance: 100%; \}/);
});

test('CSS warns about what it cannot express', () => {
  const scene = createScene({
    source: '<svg><stop id="s"/><rect id="r" transform="rotate(5)"/></svg>',
    animators: [
      { id: 'off', target: 's', property: 'offset', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1 }] },
      { id: 'kx', target: 'r', property: 'skewX', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 10 }] },
      { id: 'ky', target: 'r', property: 'skewY', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 10 }] },
    ],
  });
  const messages = exportCss(scene).warnings.map((w) => w.message).join('\n');
  assert.match(messages, /"offset" cannot be animated with CSS/);
  assert.match(messages, /overrides the element's transform attribute/);
  assert.match(messages, /only one of skewX \/ skewY/);
});

test('missing targets, duplicates and invalid input', () => {
  const later: Animator = { ...spin, id: 'spin2', keyframes: [{ t: 0, value: 0 }, { t: 2, value: -90 }] };
  const ghost: Animator = { ...spin, id: 'ghost', target: 'nowhere' };
  const { svg, warnings } = exportSmil(sceneWith([spin, later, ghost]));
  const anims = children(svg, 'box');
  assert.equal(anims.length, 1);
  assert.equal(getAttr(anims[0], 'values'), '0 0 0;-90 0 0'); // later animator wins
  assert.ok(warnings.some((w) => w.path === 'animators/1/property')); // scene warning
  assert.ok(warnings.some((w) => w.path === 'animators/2/target'));

  assert.throws(() => exportSmil(sceneWith([{ ...spin, keyframes: [] }])), SceneError);
  assert.throws(() => exportSmil(createScene({ animators: [spin] })), /no SVG markup/);
});

test('exports are deterministic and well-formed', () => {
  const scene = sceneWith([spin, { id: 'c', target: 'dot', property: 'fill', keyframes: [{ t: 0, value: 'red' }, { t: 2, value: 'blue', ease: 'elastic-out' }] }], {
    background: '#123456',
  });
  for (const format of ['smil', 'css'] as const) {
    const a = exportAnimatedSvg(scene, format).svg;
    assert.equal(a, exportAnimatedSvg(scene, format).svg);
    const doc = parseSvg(a);
    const bg = doc.root.children[format === 'css' ? 1 : 0] as SvgElement;
    assert.equal(getAttr(bg, 'fill'), '#123456');
  }
  assert.ok(cssNative({ cubicBezier: [0.3, -0.5, 0.7, 1.5] }));
  assert.ok(!smilNative({ cubicBezier: [0.3, -0.5, 0.7, 1.5] }));
});

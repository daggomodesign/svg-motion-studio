# @svg-motion-studio/core

Engine kernel of SVG Motion Studio. Pure TypeScript — no DOM, no Node APIs — so it runs in
browsers, Node.js and Termux.

## Modules

| Module | What it does |
|---|---|
| `easing` | 18 presets, CSS-compatible `cubic-bezier()`, `isEasing` validation |
| `values` | Value types: `numberType`, `vectorType`, `colorType` (+ `parseColor` / `formatColor`) |
| `path` | `parsePath` / `formatPath`, normalization to absolute `M L C Q A Z`, `pathType` morphing |
| `track` | `compileTrack` (sort, parse, resolve easings once) + `sampleCompiled` (O(log n)) |
| `timeline` | `localTime` for once / loop / ping-pong, frame grids, `formatTime` |
| `scene` | `Scene` / `Animator` / `Trigger` model, `PROPERTIES`, `validateScene`, `compileScene`, `evaluateScene` |

## Example

```ts
import { compileScene, createScene, evaluateScene } from '@svg-motion-studio/core';

const scene = createScene({
  duration: 2,
  animators: [
    { id: 'spin', target: 'logo', property: 'rotate',
      keyframes: [{ t: 0, value: 0 }, { t: 2, value: 360, ease: 'ease-in-out' }] },
    { id: 'tint', target: 'logo', property: 'fill',
      keyframes: [{ t: 0, value: '#ff3366' }, { t: 2, value: '#3366ff' }] },
  ],
});

const compiled = compileScene(scene);  // validates; throws SceneError with located issues
evaluateScene(compiled, 1);            // { logo: { rotate: 180, fill: '#994db3' } }
```

## Tests

```sh
npm test   # from the repo root or this folder
```

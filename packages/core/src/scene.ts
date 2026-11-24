/**
 * Scene model: the document-level contract shared by the editor, the CLI,
 * the exporters and the MCP server.
 *
 * A scene is plain JSON. `core` does not parse SVG markup — it only knows
 * element ids (`target`) and property names; the SVG pipeline binds them to
 * real nodes.
 */

import { isEasing } from './easing.js';
import { parsePath, pathType } from './path.js';
import { localTime, type LoopMode } from './timeline.js';
import { compileTrack, sampleCompiled, type CompiledTrack, type Track } from './track.js';
import { colorType, numberType, parseColor, vectorType, type ValueType } from './values.js';

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/** The value kinds an animatable property can have. */
export type ValueKind = 'number' | 'vector' | 'color' | 'path';

/** UI grouping of properties (matches the animator groups of the spec). */
export type PropertyGroup = 'transform' | 'paint' | 'effects' | 'geometry';

/** Static description of an animatable property. */
export interface PropertyInfo {
  /** Value kind of the property's keyframes. */
  readonly kind: ValueKind;
  /** Animator group, for the editor's panels. */
  readonly group: PropertyGroup;
  /** Required vector length, for `vector` properties. */
  readonly size?: number;
  /** Human description. */
  readonly description: string;
}

/** Every animatable property known to the engine. */
export const PROPERTIES = {
  translate: { kind: 'vector', size: 2, group: 'transform', description: 'Position offset [x, y] in user units' },
  scale: { kind: 'vector', size: 2, group: 'transform', description: 'Size factor [sx, sy] around the origin' },
  rotate: { kind: 'number', group: 'transform', description: 'Rotation in degrees around the origin' },
  skewX: { kind: 'number', group: 'transform', description: 'Horizontal skew in degrees' },
  skewY: { kind: 'number', group: 'transform', description: 'Vertical skew in degrees' },
  origin: { kind: 'vector', size: 2, group: 'transform', description: 'Transform origin [x, y] in user units' },

  opacity: { kind: 'number', group: 'paint', description: 'Element opacity, 0–1' },
  fill: { kind: 'color', group: 'paint', description: 'Fill color' },
  'fill-opacity': { kind: 'number', group: 'paint', description: 'Fill opacity, 0–1' },
  stroke: { kind: 'color', group: 'paint', description: 'Stroke color' },
  'stroke-opacity': { kind: 'number', group: 'paint', description: 'Stroke opacity, 0–1' },
  'stroke-width': { kind: 'number', group: 'paint', description: 'Stroke width in user units' },
  'stroke-dashoffset': { kind: 'number', group: 'paint', description: 'Dash offset (line-drawing effects)' },
  'stop-color': { kind: 'color', group: 'paint', description: 'Gradient stop color (target a <stop>)' },
  offset: { kind: 'number', group: 'paint', description: 'Gradient stop offset, 0–1 (target a <stop>)' },

  blur: { kind: 'number', group: 'effects', description: 'Gaussian blur standard deviation' },

  d: { kind: 'path', group: 'geometry', description: 'Path morph (keyframes need matching structure)' },
  motion: { kind: 'number', group: 'geometry', description: 'Progress 0–1 along the animator motionPath' },
  x: { kind: 'number', group: 'geometry', description: 'x attribute' },
  y: { kind: 'number', group: 'geometry', description: 'y attribute' },
  width: { kind: 'number', group: 'geometry', description: 'width attribute' },
  height: { kind: 'number', group: 'geometry', description: 'height attribute' },
  cx: { kind: 'number', group: 'geometry', description: 'Circle/ellipse center x' },
  cy: { kind: 'number', group: 'geometry', description: 'Circle/ellipse center y' },
  r: { kind: 'number', group: 'geometry', description: 'Circle radius' },
  rx: { kind: 'number', group: 'geometry', description: 'Horizontal radius' },
  ry: { kind: 'number', group: 'geometry', description: 'Vertical radius' },
} as const satisfies Readonly<Record<string, PropertyInfo>>;

/** Name of an animatable property. */
export type PropertyName = keyof typeof PROPERTIES;

/** True when `name` is a known animatable property. */
export function isProperty(name: unknown): name is PropertyName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PROPERTIES, name);
}

/** The {@link ValueType} used for a value kind. */
export function valueTypeFor(kind: ValueKind): ValueType<AnimValue, unknown> {
  // Each kind accepts a different subset of AnimValue; callers validate the
  // value against the property kind first, so widening here is safe.
  const types: Record<ValueKind, unknown> = {
    number: numberType,
    vector: vectorType,
    color: colorType,
    path: pathType,
  };
  return types[kind] as ValueType<AnimValue, unknown>;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** Any keyframe value: number, `[x, y]`-style vector, color string or path string. */
export type AnimValue = number | string | readonly number[];

/** When an animator starts playing. */
export type Trigger =
  | { readonly type: 'autoplay'; /** Seconds to wait after load. */ readonly delay?: number }
  | { readonly type: 'click'; /** Element id to listen on; defaults to the animator target. */ readonly target?: string }
  | { readonly type: 'hover'; /** Element id to listen on; defaults to the animator target. */ readonly target?: string }
  | { readonly type: 'manual' };

/** Binds one element property to a keyframe track. */
export interface Animator {
  /** Unique id within the scene. */
  readonly id: string;
  /** Id of the SVG element being animated. */
  readonly target: string;
  /** Animated property. */
  readonly property: PropertyName;
  /** Keyframes; times in seconds on the scene timeline. */
  readonly keyframes: Track<AnimValue>;
  /** Muted animators are kept but not evaluated. Defaults to `true`. */
  readonly enabled?: boolean;
  /** Defaults to `{ type: 'autoplay' }`. */
  readonly trigger?: Trigger;
  /** Path data followed by a `motion` animator. */
  readonly motionPath?: string;
}

/** Current scene format version. */
export const SCENE_VERSION = 1;

/** One SVG document plus its timeline. */
export interface Scene {
  /** Format version; always {@link SCENE_VERSION}. */
  readonly version: typeof SCENE_VERSION;
  /** Canvas width in user units. */
  readonly width: number;
  /** Canvas height in user units. */
  readonly height: number;
  /** Timeline length in seconds. */
  readonly duration: number;
  /** Frames per second used as the output timing reference. */
  readonly fps: number;
  /** Repeat behaviour after `duration`. */
  readonly loop: LoopMode;
  /** Passes for `loop` / `ping-pong`; defaults to infinite. */
  readonly iterations?: number;
  /** Background color; transparent when omitted. */
  readonly background?: string;
  /** SVG markup, interpreted by the SVG pipeline (opaque to `core`). */
  readonly source?: string;
  /** Animated properties. */
  readonly animators: readonly Animator[];
}

/** Create an empty scene with sensible defaults. */
export function createScene(overrides: Partial<Omit<Scene, 'version'>> = {}): Scene {
  return {
    version: SCENE_VERSION,
    width: 512,
    height: 512,
    duration: 3,
    fps: 60,
    loop: 'loop',
    animators: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A problem found by {@link validateScene}. */
export interface SceneIssue {
  /** `error` blocks compilation; `warning` does not. */
  readonly severity: 'error' | 'warning';
  /** JSON-pointer-like location, e.g. `animators/2/keyframes/0/value`. */
  readonly path: string;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Thrown by {@link compileScene} when validation finds errors. */
export class SceneError extends Error {
  /** Every issue found, errors and warnings. */
  readonly issues: readonly SceneIssue[];
  constructor(issues: readonly SceneIssue[]) {
    const errors = issues.filter((i) => i.severity === 'error');
    super(`invalid scene: ${errors.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'SceneError';
    this.issues = issues;
  }
}

const LOOP_MODES: readonly string[] = ['once', 'loop', 'ping-pong'];
const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function validateTrigger(trigger: unknown, path: string, issues: SceneIssue[]): void {
  if (trigger === undefined) return;
  const t = trigger as { type?: unknown; delay?: unknown; target?: unknown };
  if (typeof t !== 'object' || t === null || !['autoplay', 'click', 'hover', 'manual'].includes(String(t.type))) {
    issues.push({ severity: 'error', path, message: 'trigger.type must be autoplay, click, hover or manual' });
    return;
  }
  if (t.type === 'autoplay' && t.delay !== undefined && !(typeof t.delay === 'number' && t.delay >= 0)) {
    issues.push({ severity: 'error', path: `${path}/delay`, message: 'delay must be a number ≥ 0' });
  }
  if ((t.type === 'click' || t.type === 'hover') && t.target !== undefined && typeof t.target !== 'string') {
    issues.push({ severity: 'error', path: `${path}/target`, message: 'target must be an element id' });
  }
}

/**
 * Check a scene (typically freshly parsed JSON) against the model.
 * Returns every issue found; an empty array means the scene is valid.
 */
export function validateScene(input: unknown): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const err = (path: string, msg: string): void => {
    issues.push({ severity: 'error', path, message: msg });
  };
  const warn = (path: string, msg: string): void => {
    issues.push({ severity: 'warning', path, message: msg });
  };

  if (typeof input !== 'object' || input === null) {
    err('', 'scene must be an object');
    return issues;
  }
  const s = input as Partial<Record<keyof Scene, unknown>>;

  if (s.version !== SCENE_VERSION) err('version', `version must be ${SCENE_VERSION}`);
  if (!isPositive(s.width)) err('width', 'width must be a number > 0');
  if (!isPositive(s.height)) err('height', 'height must be a number > 0');
  if (!isPositive(s.duration)) err('duration', 'duration must be a number > 0');
  if (!isPositive(s.fps) || (s.fps as number) > 240) err('fps', 'fps must be within (0, 240]');
  if (!LOOP_MODES.includes(String(s.loop))) err('loop', 'loop must be once, loop or ping-pong');
  if (s.iterations !== undefined && !isPositive(s.iterations)) err('iterations', 'iterations must be > 0');
  if (s.background !== undefined) {
    try {
      parseColor(s.background as string);
    } catch (e) {
      err('background', message(e));
    }
  }
  if (s.source !== undefined && typeof s.source !== 'string') err('source', 'source must be SVG markup');
  if (!Array.isArray(s.animators)) {
    err('animators', 'animators must be an array');
    return issues;
  }

  const duration = isPositive(s.duration) ? s.duration : Infinity;
  const ids = new Set<string>();
  const bindings = new Map<string, string>();

  s.animators.forEach((raw: unknown, ai: number) => {
    const base = `animators/${ai}`;
    if (typeof raw !== 'object' || raw === null) {
      err(base, 'animator must be an object');
      return;
    }
    const a = raw as Partial<Record<keyof Animator, unknown>>;

    if (typeof a.id !== 'string' || a.id === '') err(`${base}/id`, 'id must be a non-empty string');
    else if (ids.has(a.id)) err(`${base}/id`, `duplicate animator id "${a.id}"`);
    else ids.add(a.id);

    if (typeof a.target !== 'string' || a.target === '') err(`${base}/target`, 'target must be an element id');
    if (a.enabled !== undefined && typeof a.enabled !== 'boolean') err(`${base}/enabled`, 'enabled must be a boolean');
    validateTrigger(a.trigger, `${base}/trigger`, issues);

    if (!isProperty(a.property)) {
      err(`${base}/property`, `unknown property "${String(a.property)}"`);
      return;
    }
    const info: PropertyInfo = PROPERTIES[a.property];

    if (a.property === 'motion') {
      try {
        parsePath(a.motionPath as string);
      } catch (e) {
        err(`${base}/motionPath`, `motion animators need a valid motionPath: ${message(e)}`);
      }
    }

    const key = `${String(a.target)}\u0000${a.property}`;
    const other = bindings.get(key);
    if (other !== undefined) {
      warn(`${base}/property`, `"${a.property}" of "${String(a.target)}" is also animated by ${other}; the later animator wins`);
    } else {
      bindings.set(key, String(a.id));
    }

    if (!Array.isArray(a.keyframes) || a.keyframes.length === 0) {
      err(`${base}/keyframes`, 'keyframes must be a non-empty array');
      return;
    }

    let validValues = true;
    a.keyframes.forEach((kf: unknown, ki: number) => {
      const kp = `${base}/keyframes/${ki}`;
      const k = (typeof kf === 'object' && kf !== null ? kf : {}) as Record<string, unknown>;
      if (typeof k.t !== 'number' || !Number.isFinite(k.t) || k.t < 0) {
        err(`${kp}/t`, 'time must be a number ≥ 0');
      } else if (k.t > duration) {
        warn(`${kp}/t`, `keyframe at ${k.t}s is after the scene end (${duration}s)`);
      }
      if (k.ease !== undefined && !isEasing(k.ease)) err(`${kp}/ease`, 'unknown easing');
      try {
        valueTypeFor(info.kind).parse(k.value as AnimValue);
        if (info.size !== undefined && (k.value as readonly number[]).length !== info.size) {
          err(`${kp}/value`, `${a.property} needs ${info.size} numbers`);
          validValues = false;
        }
      } catch (e) {
        err(`${kp}/value`, message(e));
        validValues = false;
      }
    });

    if (validValues && !issues.some((i) => i.severity === 'error' && i.path.startsWith(`${base}/keyframes`))) {
      try {
        compileTrack(a.keyframes as Track<AnimValue>, valueTypeFor(info.kind));
      } catch (e) {
        err(`${base}/keyframes`, message(e));
      }
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** An animator with its track compiled for sampling. */
export interface CompiledAnimator {
  /** The source animator. */
  readonly animator: Animator;
  /** Compiled keyframe track. */
  readonly track: CompiledTrack<AnimValue, unknown>;
}

/** A scene ready to be evaluated frame by frame. */
export interface CompiledScene {
  /** The source scene. */
  readonly scene: Scene;
  /** Enabled animators, in scene order. */
  readonly animators: readonly CompiledAnimator[];
}

/**
 * Validate and compile a scene. Throws {@link SceneError} if validation finds
 * errors (warnings are allowed). Disabled animators are dropped.
 */
export function compileScene(scene: Scene): CompiledScene {
  const issues = validateScene(scene);
  if (issues.some((i) => i.severity === 'error')) throw new SceneError(issues);
  const animators = scene.animators
    .filter((a) => a.enabled !== false)
    .map((animator) => ({
      animator,
      track: compileTrack(animator.keyframes, valueTypeFor(PROPERTIES[animator.property].kind)),
    }));
  return { scene, animators };
}

/** Evaluated property values per element id, e.g. `{ logo: { rotate: 90, fill: '#ff0000' } }`. */
export type SceneFrame = Record<string, Partial<Record<PropertyName, AnimValue>>>;

/** Runtime state of interactive triggers. */
export interface EvaluateOptions {
  /**
   * Scene time (seconds) at which each non-autoplay animator was activated,
   * keyed by animator id. Animators that were never activated rest on their
   * first keyframe.
   */
  readonly starts?: Readonly<Record<string, number>>;
}

/**
 * Evaluate every animator at scene time `time` (seconds since load).
 *
 * Each animator runs on its own clock: autoplay animators start at their
 * delay, interactive ones at the time recorded in `options.starts`. Elapsed
 * time is then mapped through the scene's loop settings onto the timeline and
 * the track is sampled there.
 */
export function evaluateScene(compiled: CompiledScene, time: number, options: EvaluateOptions = {}): SceneFrame {
  const { scene } = compiled;
  const playback = { duration: scene.duration, loop: scene.loop, iterations: scene.iterations };
  const frame: SceneFrame = {};

  for (const { animator, track } of compiled.animators) {
    const trigger = animator.trigger ?? { type: 'autoplay' };
    const start = trigger.type === 'autoplay' ? trigger.delay ?? 0 : options.starts?.[animator.id];
    const t = start === undefined ? 0 : localTime(time - start, playback);
    const values = (frame[animator.target] ??= {});
    values[animator.property] = sampleCompiled(track, t);
  }
  return frame;
}

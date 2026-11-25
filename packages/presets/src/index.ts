/**
 * Animation recipes.
 *
 * A preset is a small, declarative description of one animator: which
 * property it drives, the keyframes it writes, and how it behaves. The editor
 * shows them as buttons; the CLI applies them by name; the MCP server can
 * compose them. All of them produce plain {@link Animator} objects, so nothing
 * here is special-cased by the engine or the exporters.
 */

import type { Animator, AnimValue, Easing, PropertyName, Trigger } from '@svg-motion-studio/core';

/** Options every preset accepts. */
interface PresetOptions {
  /** Length of the animation in seconds. */
  readonly duration?: number;
  /** Seconds to wait before it starts. */
  readonly delay?: number;
  /** Easing for the main movement. */
  readonly ease?: Easing;
  /** When the animator plays. Defaults to autoplay. */
  readonly trigger?: Trigger;
  /** Distance in user units, for the presets that move. */
  readonly distance?: number;
  /** Rotation origin `[x, y]`, for the presets that rotate or scale. */
  readonly origin?: readonly [number, number];
  /** Id prefix, so several presets on one element stay unique. */
  readonly idPrefix?: string;
}

/** A preset definition. */
export interface Preset {
  /** Stable id, used by the CLI and the editor. */
  readonly id: string;
  /** Human name, in Portuguese. */
  readonly name: string;
  /** One-line description of what it does. */
  readonly description: string;
  /** Animator group, for grouping in the UI. */
  readonly group: 'entrance' | 'emphasis' | 'loop' | 'exit';
  /** Default duration in seconds. */
  readonly duration: number;
  /** Build the animators for one element. */
  readonly build: (target: string, options?: PresetOptions) => Animator[];
}

const DEFAULT_EASE: Easing = 'ease-out';

/** Build an animator, filling in the defaults. */
function animator(
  id: string,
  target: string,
  property: PropertyName,
  keyframes: readonly { t: number; value: AnimValue; ease?: Easing }[],
  options: PresetOptions = {},
): Animator {
  return {
    id: options.idPrefix === undefined ? id : `${options.idPrefix}-${id}`,
    target,
    property,
    keyframes,
    trigger: options.trigger ?? { type: 'autoplay', delay: options.delay ?? 0 },
  };
}

/** An `origin` animator, when the preset needs a pivot. */
function originAnimator(presetId: string, target: string, options: PresetOptions): Animator[] {
  if (options.origin === undefined) return [];
  return [
    animator(`${presetId}-origin`, target, 'origin', [{ t: 0, value: [options.origin[0], options.origin[1]] }], options),
  ];
}

/**
 * Fade in: opacity 0 → 1.
 */
const fadeIn: Preset = {
  id: 'fade-in',
  name: 'Fade in',
  description: 'Aparece suavemente a partir do transparente.',
  group: 'entrance',
  duration: 0.6,
  build: (target, options = {}) => {
    const d = options.duration ?? 0.6;
    return [
      animator('fade', target, 'opacity', [
        { t: 0, value: 0 },
        { t: d, value: 1, ease: options.ease ?? DEFAULT_EASE },
      ], options),
    ];
  },
};

/**
 * Slide in from the left, with a fade.
 */
const slideIn: Preset = {
  id: 'slide-in',
  name: 'Slide in',
  description: 'Entra deslizando a partir da esquerda.',
  group: 'entrance',
  duration: 0.7,
  build: (target, options = {}) => {
    const d = options.duration ?? 0.7;
    const dist = options.distance ?? 40;
    const ease = options.ease ?? 'ease-out';
    return [
      animator('slide', target, 'translate', [
        { t: 0, value: [-dist, 0] },
        { t: d, value: [0, 0], ease },
      ], options),
      animator('slide-fade', target, 'opacity', [
        { t: 0, value: 0 },
        { t: d * 0.8, value: 1, ease },
      ], options),
    ];
  },
};

/**
 * Pop: scale up from nothing with a springy overshoot.
 */
const pop: Preset = {
  id: 'pop',
  name: 'Pop',
  description: 'Cresce do nada com um pequeno ressalto.',
  group: 'entrance',
  duration: 0.5,
  build: (target, options = {}) => {
    const d = options.duration ?? 0.5;
    return [
      ...originAnimator('pop', target, options),
      animator('pop', target, 'scale', [
        { t: 0, value: [0, 0] },
        { t: d, value: [1, 1], ease: options.ease ?? 'ease-out-back' },
      ], options),
      animator('pop-fade', target, 'opacity', [
        { t: 0, value: 0 },
        { t: d * 0.5, value: 1, ease: 'ease-out' },
      ], options),
    ];
  },
};

/**
 * Spin: one full rotation.
 */
const spin: Preset = {
  id: 'spin',
  name: 'Rodar',
  description: 'Uma volta completa em torno do centro.',
  group: 'emphasis',
  duration: 1.2,
  build: (target, options = {}) => {
    const d = options.duration ?? 1.2;
    return [
      ...originAnimator('spin', target, options),
      animator('spin', target, 'rotate', [
        { t: 0, value: 0 },
        { t: d, value: 360, ease: options.ease ?? 'ease-in-out' },
      ], options),
    ];
  },
};

/**
 * Pulse: a gentle scale heartbeat, meant to loop.
 */
const pulse: Preset = {
  id: 'pulse',
  name: 'Pulsar',
  description: 'Um batimento suave, pensado para repetir.',
  group: 'loop',
  duration: 1.4,
  build: (target, options = {}) => {
    const d = options.duration ?? 1.4;
    return [
      ...originAnimator('pulse', target, options),
      animator('pulse', target, 'scale', [
        { t: 0, value: [1, 1] },
        { t: d / 2, value: [1.08, 1.08], ease: 'ease-in-out' },
        { t: d, value: [1, 1], ease: 'ease-in-out' },
      ], options),
    ];
  },
};

/**
 * Float: a slow vertical drift, meant to loop.
 */
const float: Preset = {
  id: 'float',
  name: 'Flutuar',
  description: 'Sobe e desce devagar, como se flutuasse.',
  group: 'loop',
  duration: 2.4,
  build: (target, options = {}) => {
    const d = options.duration ?? 2.4;
    const dist = options.distance ?? 8;
    return [
      animator('float', target, 'translate', [
        { t: 0, value: [0, 0] },
        { t: d / 2, value: [0, -dist], ease: 'ease-in-out' },
        { t: d, value: [0, 0], ease: 'ease-in-out' },
      ], options),
    ];
  },
};

/**
 * Wiggle: a small rotation oscillation, meant to loop.
 */
const wiggle: Preset = {
  id: 'wiggle',
  name: 'Ondular',
  description: 'Oscila em torno do centro, com vida.',
  group: 'loop',
  duration: 1.6,
  build: (target, options = {}) => {
    const d = options.duration ?? 1.6;
    const amount = options.distance ?? 6;
    return [
      ...originAnimator('wiggle', target, options),
      animator('wiggle', target, 'rotate', [
        { t: 0, value: 0 },
        { t: d * 0.25, value: amount, ease: 'ease-in-out' },
        { t: d * 0.5, value: 0, ease: 'ease-in-out' },
        { t: d * 0.75, value: -amount, ease: 'ease-in-out' },
        { t: d, value: 0, ease: 'ease-in-out' },
      ], options),
    ];
  },
};

/**
 * Draw: reveal a stroke by animating its dash offset.
 */
const draw: Preset = {
  id: 'draw',
  name: 'Desenhar',
  description: 'Revela o traço como se estivesse a ser desenhado.',
  group: 'entrance',
  duration: 1.5,
  build: (target, options = {}) => {
    const d = options.duration ?? 1.5;
    const length = options.distance ?? 1000;
    return [
      animator('draw', target, 'stroke-dashoffset', [
        { t: 0, value: length },
        { t: d, value: 0, ease: options.ease ?? 'ease-in-out' },
      ], options),
    ];
  },
};

/**
 * Bounce: drop in from above and settle.
 */
const bounce: Preset = {
  id: 'bounce',
  name: 'Saltar',
  description: 'Cai de cima e assenta com um ressalto.',
  group: 'entrance',
  duration: 0.9,
  build: (target, options = {}) => {
    const d = options.duration ?? 0.9;
    const dist = options.distance ?? 60;
    return [
      animator('bounce', target, 'translate', [
        { t: 0, value: [0, -dist] },
        { t: d, value: [0, 0], ease: options.ease ?? 'bounce-out' },
      ], options),
      animator('bounce-fade', target, 'opacity', [
        { t: 0, value: 0 },
        { t: d * 0.3, value: 1, ease: 'ease-out' },
      ], options),
    ];
  },
};

/**
 * Shake: a quick horizontal jitter, for attention.
 */
const shake: Preset = {
  id: 'shake',
  name: 'Tremer',
  description: 'Um abanão rápido para chamar a atenção.',
  group: 'emphasis',
  duration: 0.6,
  build: (target, options = {}) => {
    const d = options.duration ?? 0.6;
    const dist = options.distance ?? 6;
    return [
      animator('shake', target, 'translate', [
        { t: 0, value: [0, 0] },
        { t: d * 0.2, value: [-dist, 0], ease: 'ease-in-out' },
        { t: d * 0.4, value: [dist, 0], ease: 'ease-in-out' },
        { t: d * 0.6, value: [-dist * 0.6, 0], ease: 'ease-in-out' },
        { t: d * 0.8, value: [dist * 0.4, 0], ease: 'ease-in-out' },
        { t: d, value: [0, 0], ease: 'ease-in-out' },
      ], options),
    ];
  },
};

/**
 * Fade out: opacity 1 → 0.
 */
const fadeOut: Preset = {
  id: 'fade-out',
  name: 'Fade out',
  description: 'Desaparece suavemente.',
  group: 'exit',
  duration: 0.6,
  build: (target, options = {}) => {
    const d = options.duration ?? 0.6;
    return [
      animator('fade-out', target, 'opacity', [
        { t: 0, value: 1 },
        { t: d, value: 0, ease: options.ease ?? 'ease-in' },
      ], options),
    ];
  },
};

/** Every preset, in the order the editor shows them. */
export const PRESETS: readonly Preset[] = [
  fadeIn,
  slideIn,
  pop,
  bounce,
  draw,
  spin,
  pulse,
  float,
  wiggle,
  shake,
  fadeOut,
];

/** Look a preset up by id. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Ids of every preset. */
export const PRESET_IDS: readonly string[] = PRESETS.map((p) => p.id);

export type { PresetOptions };

export * from './auto.js';

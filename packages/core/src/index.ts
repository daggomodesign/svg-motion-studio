/**
 * @svg-motion-studio/core — engine kernel.
 *
 * Pure time-evaluation for keyframed properties: easing curves, value types
 * (numbers, vectors, colors, paths), track sampling, timeline math and the
 * scene model. No DOM, no Node-specific APIs — this module runs in browsers,
 * Node.js and Termux alike.
 *
 * Everything else in the studio (SVG pipeline, exporters, editor, CLI, MCP)
 * builds on top of `compileScene` + `evaluateScene`, or on the lower-level
 * `compileTrack` + `sampleCompiled`.
 */

export * from './easing.js';
export * from './values.js';
export * from './path.js';
export * from './track.js';
export * from './timeline.js';
export * from './scene.js';

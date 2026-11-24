/**
 * @svg-motion-studio/core — engine kernel.
 *
 * Pure time-evaluation for keyframed properties: easing curves, value types
 * (numbers, vectors, colors, paths) and track sampling. No DOM, no
 * Node-specific APIs — this module runs in browsers, Node.js and Termux alike.
 *
 * Everything else in the studio (SVG pipeline, exporters, editor, CLI, MCP)
 * builds on top of `compileTrack` + `sampleCompiled`.
 */

export * from './easing.js';
export * from './values.js';
export * from './path.js';
export * from './track.js';

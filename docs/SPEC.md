# SVG Motion Studio — Functional Specification

**Version:** 0.1 (M0 draft) · **Status:** evolving.

This is our own specification, written clean-room from the public, observable behavior of
the class of tools it belongs to. See [CLEANROOM.md](CLEANROOM.md) for methodology and
provenance.

## 1. Purpose

Let anyone create, edit, preview and export animated SVG through a timeline-based
interface — without hand-writing animation code — and run the result anywhere an SVG
runs: browsers, apps, documents, kiosks.

## 2. Surfaces

| Surface | What it does |
|---|---|
| **Editor** (web, mobile-friendly) | Canvas center, layers panel left, animators panel right, timeline bottom |
| **CLI** | `build`, `export`, `serve` — first-class on Termux/Android |
| **MCP server** | Programmatic control of the same operations for AI agents |

All three surfaces share one engine (`core` + `svg` + `export`).

## 3. Scene model

- **Scene** — one SVG document plus timeline settings: duration, FPS (output timing
  reference), loop mode, background.
- **Element** — any addressable node in the document: shapes, groups, text, gradients,
  filters.
- **Animator** — binds one element to one animatable property and owns a keyframe track.
- **Keyframe** — `{ time, value, easing }`; easing is per-segment.
- **Trigger** — when an animator plays: `autoplay` (optional delay), `click`, `hover`,
  or a programmatic call.

## 4. Animator types (target set)

| Group | Animators |
|---|---|
| Transform | position, size, rotate, skew |
| Paint | opacity, fill, stroke, gradient stops |
| Effects | filter parameters (blur, drop shadow) |
| Geometry | path morphing (requires compatible path structure), motion path (translate along a Bézier) |

## 5. Easing

- `linear` (default)
- Presets: ease-in / ease-out / ease-in-out families (quad, cubic, back), bounce-out,
  elastic-out
- Custom: `cubic-bezier(x1, y1, x2, y2)`
- Steps: `step-start`, `step-end`

## 6. Timeline and keyframe editing

Add, delete and duplicate keyframes; drag-to-retime; scrubbing; play/pause/loop;
configurable FPS; per-animator enable/mute; multi-select where practical.

## 7. Triggers and interactivity

Autoplay with optional delay and start/end offsets; click and hover on chosen elements;
programmatic play/pause/seek on exported outputs whenever the target format supports it.

## 8. Export formats

| Format | Notes |
|---|---|
| Animated SVG (SMIL) | single self-contained file |
| Animated SVG (CSS keyframes) | CSS-only variant |
| JS player + SVG | runtime script + asset pair |
| Lottie JSON | schema-conformant output |
| Video (MP4, WebM, …) | headless render pipeline |
| Image sequence / GIF / APNG | frame-based output |

## 9. Performance targets (engine)

- Track sampling: O(log n) per track per frame after a one-time compilation step.
- Zero DOM/Node dependencies in `core`.
- Deterministic exports: same input, same output bytes.

## 10. Non-goals for M1

Editor UI, video pipeline, Lottie and the MCP server — they arrive after the engine
kernel (model, easing, sampling, timeline math) is proven by tests.

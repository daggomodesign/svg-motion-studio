# SVG Motion Studio

**Clean-room SVG animation studio — engine, CLI and editor that run anywhere, from the browser to Android (Termux).**

[Leia em português (pt-PT)](README.pt-PT.md)

> Status: **alpha** — the full loop works end to end: import a drawing from
> CorelDRAW or Inkscape, animate it in the editor or the CLI, export animated SVG or a
> standalone HTML player.

## What it is

SVG Motion Studio is an independent, original implementation of a modern SVG animation
workbench:

- a **pure TypeScript engine** — animation model, keyframes, easing, interpolation — with
  zero DOM dependencies, so it runs in browsers, Node.js and Termux;
- an **import pipeline** that takes a real drawing-tool export (CorelDRAW, Inkscape,
  Illustrator) and makes it animatable: units normalized, editor metadata removed, CSS
  flattened, ids assigned, layers detected;
- **11 animation presets** plus auto-animate, so a drawing can move within a second of
  being imported;
- **multi-format exporters** — animated SVG (SMIL or CSS) and a standalone HTML player;
- a **mobile-first timeline editor** and a **CLI**, both built on the same engine;
- an **MCP server** so AI agents can drive the studio programmatically.

## Android-first

The core is plain TypeScript, so your phone is a first-class target:

```sh
pkg install nodejs git          # Termux
git clone https://github.com/daggomodesign/svg-motion-studio.git
cd svg-motion-studio
npm install && npm run build

# the graphical editor, in the phone's browser
node packages/cli/dist/src/cli.js serve --port 8080

# or the command line
node packages/cli/dist/src/cli.js import my-drawing.svg --out work
```

Requires Node.js 18 or newer (20+ recommended). See
[docs/ANDROID-PT.md](docs/ANDROID-PT.md) for the full Termux walkthrough, and
[docs/IMPORT-PT.md](docs/IMPORT-PT.md) for how to export from CorelDRAW and Inkscape.

## Clean-room policy

This project is built **clean-room**: we study only public, observable behavior of
existing animation tools (published feature lists, docs, open file-format specs) and
write 100% original code. No third-party code, assets, names or branding is copied or
included. Output files follow the open specifications of each target format (SMIL, CSS,
WAAPI, Lottie).

See [docs/CLEANROOM.md](docs/CLEANROOM.md) for the methodology and the provenance log.

## Architecture

```
packages/
  core/     engine kernel: model, keyframes, easing, interpolation   (no DOM, no Node)
  svg/      SVG parse → animate → serialize pipeline (+ matrices, bounding boxes)
  import/   drawing-tool exports → clean, animatable documents
  presets/  animation recipes (fade, slide, pop, spin, draw, …) + auto-animate
  export/   renderers: animated SVG (SMIL and CSS)
  player/   one self-contained HTML player for a scene
  cli/      terminal tool — first-class citizen on Termux
  editor/   mobile-first web editor, builds to a single HTML file
  mcp/      MCP server for AI agents
```

Layering rule: `core` depends on nothing; `svg` and `export` depend on `core`; `cli`,
`editor` and `mcp` are surfaces on top. No layer reaches backwards.

## Roadmap

- [x] **M0** — repository, clean-room policy, functional spec
- [x] **M1** — engine kernel: keyframes, easing, value types (number, vector, color, path),
  sampling, timeline math, scene model ([packages/core](packages/core/README.md))
- [x] **M2** — SVG pipeline + animated SVG (SMIL/CSS) exporters
  ([packages/svg](packages/svg), [packages/export](packages/export))
- [x] **M3** — import pipeline for CorelDRAW / Inkscape / Illustrator
  ([packages/import](packages/import)), animation presets ([packages/presets](packages/presets))
- [x] **M4** — CLI (`import`, `animate`, `auto`, `export`, `player`, `serve`, `doctor`)
  ([packages/cli](packages/cli)) + Termux guide
- [x] **M5** — mobile-first web editor ([packages/editor](packages/editor)) and standalone
  HTML player ([packages/player](packages/player))
- [ ] **M6** — MCP server, Lottie + video exporters, APK shell

## Documentation

- [Functional specification](docs/SPEC.md)
- [Exporting from CorelDRAW and Inkscape](docs/IMPORT-PT.md) (pt-PT)
- [Running on Android with Termux](docs/ANDROID-PT.md) (pt-PT)
- [Clean-room methodology](docs/CLEANROOM.md)
- [AGENTS.md](AGENTS.md) — rules for AI coding agents

## License

[MIT](LICENSE) © 2026 daggomodesign

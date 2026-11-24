# SVG Motion Studio

**Clean-room SVG animation studio — engine, CLI and editor that run anywhere, from the browser to Android (Termux).**

[Leia em português (pt-PT)](README.pt-PT.md)

> Status: **pre-alpha** — M1 (engine kernel) and M2 (SVG pipeline + animated SVG export) done; M3 (CLI) next.

## What it is

SVG Motion Studio is an independent, original implementation of a modern SVG animation
workbench:

- a **pure TypeScript engine** — animation model, keyframes, easing, interpolation — with
  zero DOM dependencies, so it runs in browsers, Node.js and Termux;
- **multi-format exporters** — animated SVG (SMIL or CSS), a JS player, Lottie JSON and
  video pipelines;
- a **timeline editor** (web UI) and a **CLI**, both built on the same engine;
- an **MCP server** so AI agents can drive the studio programmatically.

## Android-first

The core is plain TypeScript, so your phone is a first-class target:

```sh
pkg install nodejs git          # Termux
git clone https://github.com/daggomodesign/svg-motion-studio.git
cd svg-motion-studio
npm install && npm test
npm run demo                    # writes examples/out/hello.smil.svg and hello.css.svg
```

Requires Node.js 22 or newer. Open the files in `examples/out/` in any browser to see
the animation. The web editor (M4) will run in any mobile browser; a Capacitor APK shell
around it is planned once the engine stabilizes (see roadmap).

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
  svg/      SVG parse → animate → serialize pipeline
  export/   renderers: animated SVG, JS player, Lottie, video
  cli/      terminal tool — first-class citizen on Termux
  editor/   web editor (mobile-friendly)
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
- [ ] **M3** — CLI (`build`, `export`, `serve`) + Termux quick-start guide
- [ ] **M4** — web editor (Preact/Lit, no heavy toolchain): canvas, layers, animators, timeline
- [ ] **M5** — MCP server, Lottie + video exporters, APK shell

## Documentation

- [Functional specification](docs/SPEC.md)
- [Clean-room methodology](docs/CLEANROOM.md)
- [AGENTS.md](AGENTS.md) — rules for AI coding agents

## License

[MIT](LICENSE) © 2026 daggomodesign

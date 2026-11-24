# Clean-room methodology

## Principle

We implement from **publicly observable behavior only** and write every line ourselves.
Nothing is taken from any existing product: no source code, no decompilation, no assets,
no names, no branding.

## Allowed inputs

- Published documentation, feature lists and marketing pages of existing tools.
- Public specifications of open formats: W3C SMIL Animation, CSS Animations, Web
  Animations (WAAPI), the Lottie JSON schema.
- General domain knowledge: Bézier math, color spaces, easing functions, SVG semantics.
- Open-source projects under permissive licenses may inspire *structure and quality
  practices* — never code.

## Forbidden inputs

- Source code of similar products in any form: leaked, decompiled or "reconstructed".
- Assets, icons, marketing copy or trademarks of other products.
- Reverse engineering of binary protocols or private APIs.

## Provenance log

Every design decision informed by an external public source gets one row.

| Date | Source (public) | What we took from it | Where it landed |
|---|---|---|---|
| 2026-11 | Public feature docs of web SVG animation tools (incl. SVGator help/marketing pages) | The feature class itself: timeline editor, animator types, triggers, export formats | [SPEC.md](SPEC.md) |
| 2026-11 | morluto/rea (MIT, open source) | Repo-quality patterns: layered architecture, AGENTS.md, MCP surface, multi-idioma README | Repo scaffolding, AGENTS.md |
| 2026-11 | W3C SMIL / CSS Animations / WAAPI specs | Export semantics for animated SVG | packages/export (M2) |
| 2026-11 | W3C CSS Easing Functions Level 1 | `cubic-bezier()` semantics and x-range rule, `ease*` preset control points, `step-start` / `step-end` behavior | packages/core/src/easing.ts |
| 2026-11 | Widely published easing equations (quad, cubic, back, bounce, elastic) | Curve formulas as general math | packages/core/src/easing.ts |
| 2026-11 | W3C CSS Color Level 4 | Hex / `rgb()` syntax, basic named colors, premultiplied-alpha interpolation | packages/core/src/values.ts |
| 2026-11 | W3C SVG 2 — Paths chapter (path data grammar, implementation notes) | Command grammar, implicit lineto, S/T control-point reflection, compact arc flags | packages/core/src/path.ts |

## Review checklist (per PR)

- [ ] No third-party code pasted or closely paraphrased.
- [ ] No third-party assets or names.
- [ ] Emitted files validated against the public spec of the target format.
- [ ] New external inputs logged in the provenance table above.

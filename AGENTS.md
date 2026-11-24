# AGENTS.md — rules for AI coding agents

These rules bind any AI agent (or human) contributing to SVG Motion Studio.

## 1. Clean-room conduct (non-negotiable)

- Base decisions on **public, observable behavior only**: published docs, feature lists,
  open format specifications.
- **Never** paste, transcribe or "reimplement from memory" third-party source code,
  decompiled code, assets or internal material from any similar product.
- When a public source informs a design decision, append a row to the provenance log in
  [docs/CLEANROOM.md](docs/CLEANROOM.md).
- Formats we emit (SMIL, CSS, WAAPI, Lottie) follow their public specifications.

## 2. Architecture

- `packages/core` is pure: no DOM, no Node-specific APIs, no filesystem, no network.
- Dependencies point downwards only:
  `core` ← `svg`/`export` ← `cli`/`editor`/`mcp`. No layer reaches backwards.
- Contracts (types) come first; implementations second.
- Prefer pure functions; side effects live at the surfaces.

## 3. Code style

- TypeScript, strict mode, ESM.
- Explicit types; no `any` without an inline justification.
- Every exported symbol carries a doc comment.

## 4. Commits

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
- One logical change per commit, small enough to review.

## 5. Definition of done (per feature)

- Types + implementation + at least one meaningful test.
- Docs updated when behavior changes.
- New dependencies justified in the PR description.

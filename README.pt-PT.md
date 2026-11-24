# SVG Motion Studio

**Estúdio de animação SVG clean-room — motor, CLI e editor que correm em qualquer lado, do browser ao Android (Termux).**

[Read in English](README.md)

> Estado: **pré-alfa** — M1 (núcleo do motor) em desenvolvimento.

## O que é

O SVG Motion Studio é uma implementação original e independente de uma bancada moderna
de animação SVG:

- um **motor em TypeScript puro** — modelo de animação, keyframes, easing, interpolação —
  sem dependências de DOM, por isso corre em browsers, Node.js e Termux;
- **exportadores multi-formato** — SVG animado (SMIL ou CSS), player JS, Lottie JSON e
  pipelines de vídeo;
- um **editor com timeline** (web UI) e uma **CLI**, ambos sobre o mesmo motor;
- um **servidor MCP** para agentes de IA controlarem o estúdio programaticamente.

## Android em primeiro lugar

O núcleo é TypeScript puro, por isso o teu telemóvel é um alvo de primeira classe:

```sh
pkg install nodejs git          # Termux
git clone https://github.com/daggomodesign/svg-motion-studio.git
cd svg-motion-studio
npm install && npm test
```

O editor corre hoje em qualquer browser móvel; uma casca APK (Capacitor) à volta do
mesmo editor está planeada para quando o motor estabilizar (ver roadmap).

## Política clean-room

Este projeto é construído em **clean-room**: estudamos apenas o comportamento público e
observável de ferramentas de animação existentes (listas de funcionalidades publicadas,
documentação, especificações abertas de formatos) e escrevemos código 100% original.
Nenhum código, asset, nome ou marca de terceiros é copiado ou incluído.

Ver [docs/CLEANROOM.md](docs/CLEANROOM.md) para a metodologia e o registo de proveniência.

## Arquitetura

```
packages/
  core/     núcleo do motor: modelo, keyframes, easing, interpolação  (sem DOM, sem Node)
  svg/      pipeline SVG: parse → animar → serializar
  export/   renderers: SVG animado, player JS, Lottie, vídeo
  cli/      ferramenta de terminal — cidadã de primeira classe no Termux
  editor/   editor web (mobile-friendly)
  mcp/      servidor MCP para agentes de IA
```

Regra de camadas: `core` não depende de nada; `svg` e `export` dependem de `core`;
`cli`, `editor` e `mcp` são superfícies por cima. Nenhuma camada olha para trás.

## Roadmap

- [x] **M0** — repositório, política clean-room, especificação funcional
- [ ] **M1** — núcleo do motor: keyframes, easing, sampling, modelo de timeline
- [ ] **M2** — pipeline SVG + exportadores SVG animado (SMIL/CSS)
- [ ] **M3** — CLI (`build`, `export`, `serve`) + guia rápido para Termux
- [ ] **M4** — editor web: canvas, camadas, animators, timeline
- [ ] **M5** — servidor MCP, exportadores Lottie + vídeo, casca APK

## Documentação

- [Especificação funcional](docs/SPEC.md)
- [Metodologia clean-room](docs/CLEANROOM.md)
- [AGENTS.md](AGENTS.md) — regras para agentes de IA

## Licença

[MIT](LICENSE) © 2026 daggomodesign

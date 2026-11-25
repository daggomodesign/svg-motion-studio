/**
 * Standalone player.
 *
 * Takes a scene, gets an animated SVG from the export package, and wraps it in
 * one HTML file: artwork, controls and styling in a single document with no
 * external requests. That is the file you send someone who just wants to watch
 * the animation — it opens in any browser on Android, from a chat attachment or
 * the local filesystem, and plays without a network.
 */

import type { Scene } from '@svg-motion-studio/core';
import { exportAnimatedSvg, type AnimatedSvgFormat } from '@svg-motion-studio/export';

/** Options for {@link renderPlayerHtml}. */
export interface PlayerOptions {
  /** Animation flavour. Defaults to `smil`, which needs no script. */
  readonly format?: AnimatedSvgFormat;
  /** Page title and caption. Defaults to `SVG Motion Studio`. */
  readonly title?: string;
  /** Page background. Defaults to a dark studio grey. */
  readonly background?: string;
  /** Show the play / pause / replay controls. Defaults to `true`. */
  readonly controls?: boolean;
  /** Fit the artwork instead of using its intrinsic size. Defaults to `true`. */
  readonly fit?: boolean;
}

/** A rendered player, plus whatever the export had to say. */
export interface PlayerResult {
  /** The complete HTML document. */
  readonly html: string;
  /** The animated SVG, on its own, for embedding. */
  readonly svg: string;
  /** Warnings from the exporter. */
  readonly warnings: readonly string[];
}

/** Escape text for safe inclusion in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a scene as a standalone HTML page.
 *
 * The SVG goes inline (not in a data URL), so the document stays readable and
 * the animation starts immediately with no decode step.
 */
export function renderPlayerHtml(scene: Scene, options: PlayerOptions = {}): PlayerResult {
  const format = options.format ?? 'smil';
  const title = options.title ?? 'SVG Motion Studio';
  const background = options.background ?? '#0b0d12';
  const controls = options.controls !== false;
  const fit = options.fit !== false;

  const exported = exportAnimatedSvg(scene, format);
  const warnings = exported.warnings
    .filter((w) => w.severity === 'warning')
    .map((w) => `${w.path}: ${w.message}`);

  // The artboard is the scene's canvas, so the artwork keeps its proportions.
  const stageCss = fit
    ? `width: min(100%, ${scene.width}px); aspect-ratio: ${scene.width} / ${scene.height};`
    : `width: ${scene.width}px; height: ${scene.height}px;`;

  const controlBar = controls
    ? `
    <div class="controls" role="group" aria-label="Controlos de reprodução">
      <button id="play" type="button" aria-label="Reproduzir">Reproduzir</button>
      <button id="replay" type="button" aria-label="Repetir do início">Repetir</button>
      <span class="meta">${scene.duration.toFixed(2)} s · ${scene.fps} fps · ${escapeHtml(scene.loop ?? 'loop')}</span>
    </div>`
    : '';

  const script = controls
    ? `
    <script>
      // SMIL animations respond to the SVG's own timeline, so "replay" is
      // implemented by reloading the node — cheap and exact.
      (function () {
        var holder = document.getElementById('art');
        var play = document.getElementById('play');
        var replay = document.getElementById('replay');
        var playing = true;
        play.addEventListener('click', function () {
          playing = !playing;
          holder.pauseAnimations();
          if (playing) holder.unpauseAnimations();
          play.textContent = playing ? 'Pausar' : 'Reproduzir';
        });
        replay.addEventListener('click', function () {
          holder.setCurrentTime(0);
          playing = true;
          holder.unpauseAnimations();
          play.textContent = 'Pausar';
        });
      })();
    </script>`
    : '';

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: ${background};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #eef1f7;
  }
  main { display: grid; gap: 1rem; justify-items: center; max-width: 100%; }
  #art {
    ${stageCss}
    max-height: 78dvh;
    border-radius: 14px;
    background: #fff;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }
  #art svg { display: block; width: 100%; height: 100%; }
  .controls { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; justify-content: center; }
  button {
    min-height: 38px;
    padding: 0 1rem;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 550;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  button:hover { background: rgba(255, 255, 255, 0.07); border-color: rgba(255, 255, 255, 0.28); }
  button:focus-visible { outline: 2px solid #7c6cff; outline-offset: 2px; }
  .meta { font-size: 0.75rem; color: #a3abbd; font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) { #art svg * { animation: none !important; } }
</style>
</head>
<body>
<main>
  <div id="art">
${exported.svg}
  </div>${controlBar}
</main>${script}
</body>
</html>
`;

  return { html, svg: exported.svg, warnings };
}

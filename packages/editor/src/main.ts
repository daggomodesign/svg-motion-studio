/**
 * SVG Motion Studio — editor.
 *
 * The whole surface is one page: import a drawing, pick an element, add an
 * animation, scrub the timeline, export. Everything runs locally in the
 * browser — no upload, no server, so it works the same on a phone in Termux as
 * on a desktop.
 *
 * The live preview is a small runtime: it compiles the scene once, then on
 * every frame evaluates it and writes the resulting values onto the real DOM
 * nodes. That is the same evaluation the exporters use, so what you see is
 * what you get.
 */

import {
  compileScene,
  evaluateScene,
  type Animator,
  type AnimValue,
  type CompiledScene,
  type PropertyName,
  type Scene,
  type SceneFrame,
} from '@svg-motion-studio/core';
import { documentBBoxes, walk, type Box, type SvgElement } from '@svg-motion-studio/svg';
import { exportCss, exportSmil } from '@svg-motion-studio/export';
import { importSvg, type ImportResult } from '@svg-motion-studio/import';
import { renderPlayerHtml } from '@svg-motion-studio/player';
import { PRESETS, autoAnimate, getPreset } from '@svg-motion-studio/presets';

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends Element = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing element #${id}`);
  return el as unknown as T;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
};

const svgIcon = (path: string, filled = false): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (filled) {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
};

const cssEscape = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/([^\w-])/g, '\\$1');

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

const toastHost = $('toasts');

function toast(message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const node = el('div', { class: 'toast', 'data-tone': tone, role: 'status' }, [
    el('span', { class: 'toast__dot', 'aria-hidden': 'true' }),
    el('span', { text: message }),
  ]);
  toastHost.append(node);
  const life = tone === 'error' ? 6000 : 3600;
  window.setTimeout(() => {
    node.style.transition = 'opacity 200ms ease, transform 200ms ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    window.setTimeout(() => node.remove(), 220);
  }, life);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface EditorState {
  /** The imported document, or `undefined` before the first import. */
  imported?: ImportResult;
  /** The scene being edited. */
  scene?: Scene;
  /** Compiled scene, rebuilt whenever the scene changes. */
  compiled?: CompiledScene;
  /** Bounding boxes in user units, keyed by element id. */
  boxes: Map<string, Box>;
  /** Selected element id. */
  selected?: string;
  /** Playback position in seconds. */
  time: number;
  /** Whether the preview is running. */
  playing: boolean;
  /** Export flavour. */
  format: 'smil' | 'css' | 'html';
  /** Timestamp of the last frame, for the clock. */
  lastFrame?: number;
}

/** Which export format was last chosen, remembered across reloads. */
const savedFormat = ((): 'smil' | 'css' | 'html' => {
  try {
    const saved = localStorage.getItem('sms-format');
    if (saved === 'css' || saved === 'html') return saved;
  } catch {
    /* private mode: fall through to the default */
  }
  return 'smil';
})();

const state: EditorState = {
  boxes: new Map(),
  time: 0,
  playing: false,
  format: savedFormat,
};

// ---------------------------------------------------------------------------
// Preview runtime
// ---------------------------------------------------------------------------

const TRANSFORM_PROPS: ReadonlySet<string> = new Set(['translate', 'rotate', 'scale', 'skewX', 'skewY', 'origin']);

/** Static transform origin per element, from the scene's `origin` animators. */
let origins = new Map<string, [number, number]>();

/** Recompute the static origins from the current scene. */
function refreshOrigins(): void {
  origins = new Map();
  for (const animator of state.scene?.animators ?? []) {
    if (animator.property !== 'origin') continue;
    const first = animator.keyframes[0]?.value;
    if (Array.isArray(first) && first.length >= 2) {
      origins.set(animator.target, [first[0], first[1]]);
    }
  }
}

const num = (value: AnimValue | undefined, fallback = 0): number =>
  typeof value === 'number' ? value : fallback;

const pair = (value: AnimValue | undefined): [number, number] =>
  Array.isArray(value) && value.length >= 2 ? [value[0], value[1]] : [0, 0];

/** Write one evaluated frame onto the live DOM. */
function applyFrame(frame: SceneFrame): void {
  const host = $('stage-svg');
  for (const [id, props] of Object.entries(frame)) {
    const node = host.querySelector<SVGElement>(`#${cssEscape(id)}`);
    if (node === null) continue;

    const [ox, oy] = origins.get(id) ?? [0, 0];
    const parts: string[] = [];

    const translate = props.translate;
    if (translate !== undefined) {
      const [tx, ty] = pair(translate);
      parts.push(`translate(${tx} ${ty})`);
    }
    if (ox !== 0 || oy !== 0) parts.push(`translate(${ox} ${oy})`);
    if (props.rotate !== undefined) parts.push(`rotate(${num(props.rotate)})`);
    if (props.scale !== undefined) {
      const [sx, sy] = pair(props.scale);
      parts.push(`scale(${sx} ${sy})`);
    }
    if (props.skewX !== undefined) parts.push(`skewX(${num(props.skewX)})`);
    if (props.skewY !== undefined) parts.push(`skewY(${num(props.skewY)})`);
    if (ox !== 0 || oy !== 0) parts.push(`translate(${-ox} ${-oy})`);

    if (parts.length > 0) node.setAttribute('transform', parts.join(' '));

    for (const [property, value] of Object.entries(props)) {
      if (TRANSFORM_PROPS.has(property)) continue;
      if (value === undefined) continue;
      if (property === 'blur') {
        node.setAttribute('filter', `blur(${num(value)}px)`);
        continue;
      }
      if (property === 'd') {
        node.setAttribute('d', String(value));
        continue;
      }
      if (property === 'motion') continue;
      node.setAttribute(String(property), String(value));
    }
  }
}

/** Rebuild the compiled scene after any change. */
function recompile(): void {
  if (state.scene === undefined) return;
  try {
    state.compiled = compileScene(state.scene);
    refreshOrigins();
  } catch (error) {
    state.compiled = undefined;
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

/** Evaluate and draw the current time. */
function renderAt(time: number): void {
  if (state.compiled === undefined) return;
  applyFrame(evaluateScene(state.compiled, time));
  updatePlayhead();
}

/** The animation loop. */
function tick(now: number): void {
  if (!state.playing || state.scene === undefined) return;
  const last = state.lastFrame ?? now;
  const delta = Math.min(0.1, (now - last) / 1000);
  state.lastFrame = now;
  state.time += delta;

  const duration = state.scene.duration;
  if (state.time > duration) {
    if (state.scene.loop === 'once') {
      state.time = duration;
      setPlaying(false);
    } else {
      state.time = state.time % duration;
    }
  }
  renderAt(state.time);
  updateTimeDisplay();
  if (state.playing) requestAnimationFrame(tick);
}

function setPlaying(playing: boolean): void {
  if (state.scene === undefined) return;
  state.playing = playing;
  state.lastFrame = undefined;
  const button = $('btn-play');
  button.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
  button.title = playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)';
  button.replaceChildren(svgIcon(playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5.5v13l11-6.5z', true));
  if (playing) requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Stage sizing
// ---------------------------------------------------------------------------

/** Fit the stage into the canvas area, preserving the drawing's aspect ratio. */
function fitStage(): void {
  const stage = $('stage');
  const canvas = $('canvas');
  if (stage.hidden || state.imported === undefined) return;

  const style = getComputedStyle(canvas);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const availW = Math.max(80, canvas.clientWidth - padX);
  const availH = Math.max(80, canvas.clientHeight - padY);

  const { width, height } = state.imported;
  const scale = Math.min(availW / width, availH / height);
  stage.style.width = `${Math.round(width * scale)}px`;
  stage.style.height = `${Math.round(height * scale)}px`;
  updateSelectionOutline();
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function updateSelectionOutline(): void {
  const outline = $('selection');
  const stage = $('stage');
  if (state.selected === undefined || state.imported === undefined) {
    outline.hidden = true;
    return;
  }
  const box = state.boxes.get(state.selected);
  if (box === undefined) {
    outline.hidden = true;
    return;
  }
  const { width, height } = state.imported;
  const scaleX = stage.clientWidth / width;
  const scaleY = stage.clientHeight / height;
  outline.hidden = false;
  outline.style.left = `${box.x * scaleX}px`;
  outline.style.top = `${box.y * scaleY}px`;
  outline.style.width = `${Math.max(2, box.width * scaleX)}px`;
  outline.style.height = `${Math.max(2, box.height * scaleY)}px`;
}

function select(id: string | undefined): void {
  state.selected = id;
  for (const row of document.querySelectorAll<HTMLElement>('.layer')) {
    row.setAttribute('aria-selected', String(row.dataset.id === id));
  }
  $('selection-name').textContent = id ?? 'nenhuma';
  updateSelectionOutline();
  renderPresets();
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

interface LayerRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly isGroup: boolean;
  readonly animators: number;
}

/** Flatten the document into rows: layer headers plus their elements. */
function buildRows(imported: ImportResult): LayerRow[] {
  const rows: LayerRow[] = [];
  const counts = new Map<string, number>();
  for (const animator of state.scene?.animators ?? []) {
    counts.set(animator.target, (counts.get(animator.target) ?? 0) + 1);
  }

  const layerIds = new Set(imported.layers.map((l) => l.id));
  const visit = (node: SvgElement, depth: number): void => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const id = child.attrs.find((a) => a.name === 'id')?.raw;
      if (id === undefined) continue;
      const isGroup = child.name === 'g';
      const isLayer = layerIds.has(id);
      if (isLayer) {
        const layer = imported.layers.find((l) => l.id === id);
        rows.push({
          id,
          name: layer?.name ?? id,
          depth: 0,
          isGroup: true,
          animators: counts.get(id) ?? 0,
        });
        visit(child, 1);
        continue;
      }
      rows.push({
        id,
        name: id,
        depth,
        isGroup,
        animators: counts.get(id) ?? 0,
      });
      if (isGroup) visit(child, depth + 1);
    }
  };
  visit(imported.doc.root, 0);
  return rows;
}

function renderLayers(): void {
  const list = $('layers-list');
  const imported = state.imported;
  if (imported === undefined) {
    list.replaceChildren(el('p', { class: 'empty__hint', text: 'Importa um desenho para começar.' }));
    $('layers-count').textContent = '0';
    return;
  }

  const rows = buildRows(imported);
  $('layers-count').textContent = String(rows.length);

  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const button = el('button', {
      class: `layer${row.isGroup ? ' layer--group' : ''}${row.depth > 0 ? ' layer--child' : ''}`,
      type: 'button',
      role: 'option',
      'aria-selected': String(row.id === state.selected),
      'data-id': row.id,
      title: row.id,
    });
    button.style.paddingLeft = `${8 + row.depth * 14}px`;

    const icon = el('span', { class: 'layer__icon', 'aria-hidden': 'true' });
    icon.append(svgIcon(row.isGroup ? 'm12 3 9 5-9 5-9-5 9-5Z' : 'M4 4h16v16H4z'));
    button.append(icon);
    button.append(el('span', { class: 'layer__name', text: row.name }));
    if (row.animators > 0) {
      button.append(el('span', { class: 'layer__badge', text: String(row.animators) }));
    }
    button.addEventListener('click', () => select(row.id));
    frag.append(button);
  }
  list.replaceChildren(frag);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function renderPresets(): void {
  const host = $('presets');
  const frag = document.createDocumentFragment();
  for (const preset of PRESETS) {
    const button = el('button', {
      class: 'preset',
      type: 'button',
      title: preset.description,
      'aria-label': `${preset.name} — ${preset.description}`,
    });
    button.append(el('span', { class: 'preset__name', text: preset.name }));
    button.append(el('span', { class: 'preset__meta', text: `${preset.duration.toFixed(1)} s` }));
    button.addEventListener('click', () => addPreset(preset.id));
    frag.append(button);
  }
  host.replaceChildren(frag);
}

/** Add a preset to the selected element. */
function addPreset(presetId: string): void {
  const preset = getPreset(presetId);
  if (preset === undefined) return;
  if (state.scene === undefined) {
    toast('Importa um desenho primeiro.', 'warning');
    return;
  }
  if (state.selected === undefined) {
    toast('Escolhe uma camada na lista à esquerda.', 'warning');
    return;
  }

  const target = state.selected;
  const box = state.boxes.get(target);
  const origin: [number, number] | undefined =
    box === undefined ? undefined : [box.x + box.width / 2, box.y + box.height / 2];

  const existing = state.scene.animators.length;
  const animators = preset.build(target, {
    origin,
    idPrefix: `${presetId}-${existing}`,
  });

  state.scene = {
    ...state.scene,
    animators: [...state.scene.animators, ...animators],
  };
  recompile();
  renderAnimators();
  renderTracks();
  renderLayers();
  renderAt(state.time);
  toast(`${preset.name} adicionado a ${target}.`, 'success');
}

/** Remove every animator that targets the selected element. */
function clearSelected(): void {
  if (state.scene === undefined || state.selected === undefined) return;
  const target = state.selected;
  const kept = state.scene.animators.filter((a) => a.target !== target);
  if (kept.length === state.scene.animators.length) {
    toast('Esta camada não tem animações.', 'info');
    return;
  }
  state.scene = { ...state.scene, animators: kept };
  recompile();
  renderAnimators();
  renderTracks();
  renderLayers();
  renderAt(state.time);
  toast(`Animações de ${target} removidas.`, 'success');
}

// ---------------------------------------------------------------------------
// Animator list
// ---------------------------------------------------------------------------

function renderAnimators(): void {
  const host = $('animators-list');
  const animators = state.scene?.animators ?? [];
  $('animators-count').textContent = String(animators.length);
  $('animators-hint').textContent = animators.length === 0 ? '—' : `${animators.length}`;

  if (animators.length === 0) {
    host.replaceChildren(
      el('p', { class: 'empty__hint', text: 'Sem animadores. Escolhe uma camada e uma predefinição.' }),
    );
    return;
  }

  const frag = document.createDocumentFragment();
  for (const animator of animators) {
    const row = el('div', { class: 'animator' });
    row.append(el('span', { class: 'animator__swatch', 'aria-hidden': 'true' }));

    const body = el('div', { class: 'animator__body' });
    body.append(el('div', { class: 'animator__name', text: `${animator.target} · ${animator.property}` }));
    const first = animator.keyframes[0]?.t ?? 0;
    const last = animator.keyframes[animator.keyframes.length - 1]?.t ?? 0;
    body.append(el('div', { class: 'animator__meta', text: `${first.toFixed(2)}s → ${last.toFixed(2)}s` }));
    row.append(body);

    const remove = el('button', {
      class: 'btn btn--icon btn--ghost btn--danger',
      type: 'button',
      'aria-label': `Remover animação ${animator.property} de ${animator.target}`,
      title: 'Remover',
    });
    remove.append(svgIcon('M6 6l12 12M18 6L6 18'));
    remove.addEventListener('click', () => removeAnimator(animator.id));
    row.append(remove);

    frag.append(row);
  }
  host.replaceChildren(frag);
}

function removeAnimator(id: string): void {
  if (state.scene === undefined) return;
  state.scene = {
    ...state.scene,
    animators: state.scene.animators.filter((a) => a.id !== id),
  };
  recompile();
  renderAnimators();
  renderTracks();
  renderLayers();
  renderAt(state.time);
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function renderTracks(): void {
  const host = $('tracks');
  const scene = state.scene;
  if (scene === undefined || scene.animators.length === 0) {
    host.replaceChildren(
      el('p', { class: 'empty__hint', text: 'Sem animadores. Escolhe uma camada e adiciona uma animação.' }),
    );
    return;
  }

  // Human names for the targets, from the layer rows.
  const names = new Map<string, string>();
  if (state.imported !== undefined) {
    for (const row of buildRows(state.imported)) names.set(row.id, row.name);
  }

  const duration = scene.duration;
  const frag = document.createDocumentFragment();
  for (const animator of scene.animators) {
    const track = el('div', { class: 'track' });
    const label = el('div', { class: 'track__label' });
    label.append(el('b', { text: names.get(animator.target) ?? animator.target }));
    label.append(document.createTextNode(` · ${animator.property}`));
    track.append(label);

    const lane = el('div', { class: 'track__lane' });
    const first = animator.keyframes[0]?.t ?? 0;
    const last = animator.keyframes[animator.keyframes.length - 1]?.t ?? 0;
    const span = el('div', { class: 'track__span' });
    span.style.left = `${(first / duration) * 100}%`;
    span.style.width = `${Math.max(0.6, ((last - first) / duration) * 100)}%`;
    lane.append(span);

    for (const keyframe of animator.keyframes) {
      const key = el('div', { class: 'track__key' });
      key.style.left = `${(keyframe.t / duration) * 100}%`;
      lane.append(key);
    }
    track.append(lane);
    frag.append(track);
  }
  host.replaceChildren(frag);
  updatePlayhead();
}

function updatePlayhead(): void {
  const scene = state.scene;
  if (scene === undefined) return;
  const ratio = Math.min(1, Math.max(0, state.time / scene.duration));
  for (const lane of document.querySelectorAll<HTMLElement>('.track__lane')) {
    let head = lane.querySelector<HTMLElement>('.playhead');
    if (head === null) {
      head = el('div', { class: 'playhead', 'aria-hidden': 'true' });
      lane.append(head);
    }
    head.style.left = `${ratio * 100}%`;
  }
}

function updateTimeDisplay(): void {
  const scene = state.scene;
  const duration = scene?.duration ?? 0;
  const display = $('time-display');
  display.replaceChildren(
    el('strong', { text: state.time.toFixed(2) }),
    document.createTextNode(` / ${duration.toFixed(2)} s`),
  );
  const scrub = $<HTMLInputElement>('input-scrub');
  if (document.activeElement !== scrub) scrub.value = String(state.time);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function importFile(file: File): Promise<void> {
  const markup = await file.text();
  let result: ImportResult;
  try {
    result = importSvg(markup);
  } catch (error) {
    toast(`Não consegui ler o SVG: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return;
  }

  state.imported = result;
  state.selected = undefined;
  state.time = 0;

  // Bounding boxes in user units, for origins and the selection outline.
  state.boxes = new Map();
  const boxes = documentBoxes(result);
  for (const [id, box] of boxes) state.boxes.set(id, box);

  // Start from a scene that already moves, so the first impression is alive.
  const origins: Record<string, [number, number]> = {};
  for (const [id, box] of state.boxes) {
    origins[id] = [box.x + box.width / 2, box.y + box.height / 2];
  }
  const animators = autoAnimate(result.elementIds, { origins, stagger: 0.1 });
  state.scene = {
    ...result.scene,
    duration: Math.max(result.scene.duration, 3),
    animators,
  };

  // Render the cleaned markup into the stage.
  $('stage-svg').innerHTML = result.svg;
  $('empty-state').hidden = true;
  $('stage').hidden = false;

  recompile();
  fitStage();
  renderLayers();
  renderAnimators();
  renderTracks();
  renderPresets();
  renderAt(0);
  updateTimeDisplay();

  $('btn-export').removeAttribute('disabled');
  $('btn-play').removeAttribute('disabled');
  $('input-scrub').removeAttribute('disabled');
  $('input-scrub').setAttribute('max', String(state.scene.duration));
  $<HTMLInputElement>('input-duration').value = String(state.scene.duration);
  $('duration-value').textContent = `${state.scene.duration.toFixed(1)} s`;

  const warnings = result.notes.filter((n) => n.severity !== 'info');
  toast(
    `${result.tool === 'unknown' ? 'Desenho' : result.tool} importado — ${result.elementIds.length} elementos, ${result.layers.length} camadas.`,
    'success',
  );
  for (const note of warnings.slice(0, 3)) toast(note.message, note.severity === 'error' ? 'error' : 'warning');

  if (!prefersReducedMotion()) setPlaying(true);
}

/** Bounding boxes keyed by element id. */
function documentBoxes(imported: ImportResult): Map<string, Box> {
  const byElement = documentBBoxes(imported.doc);
  const out = new Map<string, Box>();
  walk(imported.doc, (node) => {
    const id = node.attrs.find((a) => a.name === 'id')?.raw;
    if (id === undefined) return;
    const box = byElement.get(node);
    if (box !== undefined) out.set(id, box);
  });
  return out;
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function doExport(): void {
  const scene = state.scene;
  if (scene === undefined) {
    toast('Nada para exportar ainda.', 'warning');
    return;
  }

  try {
    if (state.format === 'html') {
      const result = renderPlayerHtml(scene);
      download('animation.html', result.html, 'text/html');
      toast('Player HTML exportado — abre em qualquer browser.', 'success');
      return;
    }
    const result = state.format === 'css' ? exportCss(scene) : exportSmil(scene);
    download(`animation.${state.format}.svg`, result.svg, 'image/svg+xml');
    const warnings = result.warnings.filter((w) => w.severity === 'warning');
    toast(
      warnings.length === 0
        ? `SVG animado exportado (${state.format.toUpperCase()}).`
        : `Exportado com ${warnings.length} aviso(s) — vê a consola.`,
      warnings.length === 0 ? 'success' : 'warning',
    );
    for (const warning of warnings.slice(0, 5)) console.warn(`${warning.path}: ${warning.message}`);
  } catch (error) {
    toast(`Falha ao exportar: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire(): void {
  const fileInput = $<HTMLInputElement>('file-input');
  const openPicker = (): void => fileInput.click();

  $('btn-import').addEventListener('click', openPicker);
  $('btn-import-empty').addEventListener('click', openPicker);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file !== undefined) void importFile(file);
    fileInput.value = '';
  });

  // Drag and drop onto the canvas.
  const canvas = $('canvas');
  for (const type of ['dragenter', 'dragover'] as const) {
    canvas.addEventListener(type, (event) => {
      event.preventDefault();
      canvas.dataset.dragging = 'true';
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    canvas.addEventListener(type, (event) => {
      event.preventDefault();
      canvas.dataset.dragging = 'false';
    });
  }
  canvas.addEventListener('drop', (event) => {
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file !== undefined) void importFile(file);
  });

  // Play / pause.
  $('btn-play').addEventListener('click', () => setPlaying(!state.playing));

  // Scrub.
  const scrub = $<HTMLInputElement>('input-scrub');
  scrub.addEventListener('input', () => {
    setPlaying(false);
    state.time = Number(scrub.value);
    renderAt(state.time);
    updateTimeDisplay();
  });

  // Duration.
  const duration = $<HTMLInputElement>('input-duration');
  duration.addEventListener('input', () => {
    if (state.scene === undefined) return;
    const value = Number(duration.value);
    state.scene = { ...state.scene, duration: value };
    $('duration-value').textContent = `${value.toFixed(1)} s`;
    scrub.max = String(value);
    recompile();
    renderTracks();
    renderAt(Math.min(state.time, value));
  });

  // Loop mode.
  const loop = $<HTMLSelectElement>('input-loop');
  loop.addEventListener('change', () => {
    if (state.scene === undefined) return;
    state.scene = { ...state.scene, loop: loop.value as Scene['loop'] };
    recompile();
  });

  // Export format.
  for (const button of document.querySelectorAll<HTMLElement>('[data-format]')) {
    button.addEventListener('click', () => {
      const value = button.dataset.format;
      state.format = value === 'css' ? 'css' : value === 'html' ? 'html' : 'smil';
      for (const other of document.querySelectorAll<HTMLElement>('[data-format]')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      try {
        localStorage.setItem('sms-format', state.format);
      } catch {
        /* private mode: the choice just will not persist */
      }
    });
  }

  $('btn-export').addEventListener('click', doExport);

  // Theme.
  $('btn-theme').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try {
      localStorage.setItem('sms-theme', next);
    } catch {
      /* private mode: the theme just will not persist */
    }
  });

  // Mobile tabs.
  for (const tab of document.querySelectorAll<HTMLElement>('.tabbar__item')) {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.panel;
      for (const other of document.querySelectorAll<HTMLElement>('.tabbar__item')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
      const map: Record<string, string> = {
        layers: 'panel-layers',
        inspector: 'panel-inspector',
        timeline: 'panel-timeline',
      };
      for (const [key, id] of Object.entries(map)) {
        const node = document.getElementById(id);
        if (node !== null) node.dataset.open = String(key === panel);
      }
    });
  }

  // Keyboard: space plays, arrows step.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      setPlaying(!state.playing);
    } else if (event.code === 'ArrowRight' && state.scene !== undefined) {
      setPlaying(false);
      state.time = Math.min(state.scene.duration, state.time + 1 / 30);
      renderAt(state.time);
      updateTimeDisplay();
    } else if (event.code === 'ArrowLeft' && state.scene !== undefined) {
      setPlaying(false);
      state.time = Math.max(0, state.time - 1 / 30);
      renderAt(state.time);
      updateTimeDisplay();
    }
  });

  // Keep the stage fitted.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => fitStage()).observe($('canvas'));
  } else {
    window.addEventListener('resize', fitStage);
  }

  // Restore the theme.
  try {
    const saved = localStorage.getItem('sms-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderPresets();
wire();

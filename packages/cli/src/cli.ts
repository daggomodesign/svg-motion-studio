/**
 * SVG Motion Studio — command-line interface.
 *
 * `sms` is the whole studio without a screen: import a drawing, apply
 * animation presets, export animated SVG. It is built to run on plain Node.js
 * with zero native dependencies, so it works in Termux on Android exactly as
 * it does on a desktop.
 *
 *   sms import drawing.svg            → clean.svg + scene.json
 *   sms animate scene.json --preset pop --target ball
 *   sms export scene.json --format smil → animation.smil.svg
 *   sms serve                          → local preview of the editor
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene, type Scene } from '@svg-motion-studio/core';
import { exportAnimatedSvg } from '@svg-motion-studio/export';
import { importSvg, TOOL_LABELS, type ImportResult } from '@svg-motion-studio/import';
import { PRESETS, autoAnimate, getPreset } from '@svg-motion-studio/presets';
import { renderPlayerHtml } from '@svg-motion-studio/player';

const here = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const cyan = (s: string): string => `\u001b[36m${s}\u001b[0m`;
const dim = (s: string): string => `\u001b[2m${s}\u001b[0m`;
const green = (s: string): string => `\u001b[32m${s}\u001b[0m`;
const yellow = (s: string): string => `\u001b[33m${s}\u001b[0m`;
const red = (s: string): string => `\u001b[31m${s}\u001b[0m`;

function fail(message: string): never {
  console.error(red(`error: ${message}`));
  process.exit(1);
}

function readScene(path: string): Scene {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read ${path}`);
  }
  try {
    return JSON.parse(raw) as Scene;
  } catch {
    fail(`${path} is not valid JSON`);
  }
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(green('✓') + ` wrote ${dim(path)} (${(content.length / 1024).toFixed(1)} kB)`);
}

function printNotes(result: ImportResult): void {
  for (const note of result.notes) {
    const icon = note.severity === 'error' ? red('✗') : note.severity === 'warning' ? yellow('!') : dim('·');
    console.log(`  ${icon} ${note.step}: ${note.message}`);
  }
}

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

function cmdImport(args: string[]): void {
  const input = args[0];
  if (input === undefined) fail('usage: sms import <drawing.svg> [--out dir]');
  const outDir = flag(args, '--out') ?? 'out';

  let markup: string;
  try {
    markup = readFileSync(input, 'utf8');
  } catch {
    fail(`cannot read ${input}`);
  }

  const result = importSvg(markup);
  console.log(cyan('import') + ` ${input}`);
  printNotes(result);
  console.log(`  ${dim('tool')} ${TOOL_LABELS[result.tool]}`);
  console.log(`  ${dim('canvas')} ${result.width}×${result.height} · ${result.layers.length} layer(s) · ${result.elementIds.length} element(s)`);

  write(join(outDir, 'clean.svg'), result.svg);
  write(join(outDir, 'scene.json'), JSON.stringify(result.scene, null, 2));
  console.log(`  ${dim('next')} sms animate ${join(outDir, 'scene.json')} --preset pop`);
}

function cmdAnimate(args: string[]): void {
  const input = args[0];
  if (input === undefined) fail('usage: sms animate <scene.json> [--preset id] [--target id] [--out file]');
  const presetId = flag(args, '--preset') ?? 'fade-in';
  const target = flag(args, '--target');
  const out = flag(args, '--out') ?? 'out/scene.json';

  const scene = readScene(input);
  const preset = getPreset(presetId);
  if (preset === undefined) fail(`unknown preset "${presetId}" (try one of: ${PRESETS.map((p) => p.id).join(', ')})`);

  const animators = preset.build(target ?? 'el-1', { idPrefix: `cli-${Date.now()}` });
  const next: Scene = { ...scene, animators: [...scene.animators, ...animators] };
  write(out, JSON.stringify(next, null, 2));
  console.log(`  ${dim('added')} ${preset.name} on ${target ?? 'el-1'}`);
}

function cmdAuto(args: string[]): void {
  const input = args[0];
  if (input === undefined) fail('usage: sms auto <scene.json> [--out file]');
  const out = flag(args, '--out') ?? 'out/scene.json';
  const scene = readScene(input);

  // Re-import the source to learn the element ids.
  if (scene.source === undefined) fail('scene has no source markup; run sms import first');
  const result = importSvg(scene.source);
  const next = {
    ...scene,
    animators: autoAnimate(result.elementIds, { stagger: 0.1 }),
    duration: Math.max(scene.duration, 3),
  };
  write(out, JSON.stringify(next, null, 2));
  console.log(`  ${dim('auto')} animated ${result.elementIds.length} element(s)`);
}

function cmdExport(args: string[]): void {
  const input = args[0];
  if (input === undefined) fail('usage: sms export <scene.json> [--format smil|css] [--out file]');
  const format = (flag(args, '--format') ?? 'smil') as 'smil' | 'css';
  const out = flag(args, '--out') ?? `out/animation.${format}.svg`;

  const scene = readScene(input);
  const result = exportAnimatedSvg(scene, format);
  for (const warning of result.warnings) {
    if (warning.severity === 'warning') console.log(`  ${yellow('!')} ${warning.path}: ${warning.message}`);
  }
  write(out, result.svg);
}

function cmdPlayer(args: string[]): void {
  const input = args[0];
  if (input === undefined) fail('usage: sms player <scene.json> [--out file] [--title text]');
  const out = flag(args, '--out') ?? 'out/player.html';
  const title = flag(args, '--title');
  const scene = readScene(input);
  const result = renderPlayerHtml(scene, title === undefined ? {} : { title });
  for (const warning of result.warnings) console.log(`  ${yellow('!')} ${warning}`);
  write(out, result.html);
  console.log(`  ${dim('open it on your phone, or send the file')}`);
}

function cmdInfo(): void {
  console.log(cyan('svg-motion-studio') + ` ${dim('(sms)')}`);
  console.log(`  presets: ${PRESETS.map((p) => p.id).join(', ')}`);
  console.log(`  formats: smil, css`);
}

function cmdDoctor(): void {
  const node = process.version;
  const major = Number(node.replace(/^v(\d+).*/, '$1'));
  console.log(cyan('doctor'));
  console.log(`  node ${node} ${major >= 18 ? green('ok') : red('too old — need ≥ 18')}`);
  console.log(`  platform ${process.platform} ${process.platform === 'android' ? green('(Termux)') : dim('')}`);
  console.log(`  editor ${existsSync(join(here, '../../../editor/dist/editor.html')) ? green('built') : yellow('not built — run npm run build in packages/editor')}`);
}

function cmdServe(args: string[]): void {
  const port = Number(flag(args, '--port') ?? '8080');
  const editor = join(here, '../../../editor/dist');
  if (!existsSync(join(editor, 'editor.html'))) {
    fail('editor not built — run npm run build in packages/editor first');
  }

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === '/index.html') path = '/editor.html';
    const file = join(editor, path);
    if (!file.startsWith(editor)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(cyan('serve') + ` editor at http://localhost:${port}/`);
    console.log(`  ${dim('on your phone, open http://<this-device-ip>:' + port + '/')}`);
  });
}

// --------------------------------------------------------------------------
// Plumbing
// --------------------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const COMMANDS: Record<string, (args: string[]) => void> = {
  import: cmdImport,
  animate: cmdAnimate,
  auto: cmdAuto,
  export: cmdExport,
  player: cmdPlayer,
  info: cmdInfo,
  doctor: cmdDoctor,
  serve: cmdServe,
};

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(`svg-motion-studio — animate your CorelDRAW / Inkscape drawings

usage: sms <command> [args]

  ${cyan('import')} <drawing.svg> [--out dir]   clean an export, write clean.svg + scene.json
  ${cyan('animate')} <scene.json> [--preset id] [--target id] [--out file]
  ${cyan('auto')} <scene.json> [--out file]     auto-animate every element
  ${cyan('export')} <scene.json> [--format smil|css] [--out file]
  ${cyan('player')} <scene.json> [--out file]   one self-contained HTML player
  ${cyan('serve')} [--port 8080]               serve the editor locally
  ${cyan('info')}                              list presets and formats
  ${cyan('doctor')}                            check the environment

presets: ${PRESETS.map((p) => p.id).join(', ')}`);
    return;
  }
  const handler = COMMANDS[command];
  if (handler === undefined) fail(`unknown command "${command}" (try sms --help)`);
  handler(args);
}

main();

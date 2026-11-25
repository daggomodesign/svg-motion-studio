import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

const cli = join(import.meta.dirname, '..', 'src', 'cli.js');

/** An Inkscape-style export, in millimetres, with a class-based stylesheet. */
const DRAWING = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="100mm" height="60mm" viewBox="0 0 100 60" inkscape:version="1.3">
  <style>.a{fill:#ff3366}.b{fill:#3366ff}</style>
  <g inkscape:groupmode="layer" inkscape:label="Fundo" id="layer1">
    <rect id="bg" class="a" x="5" y="5" width="40" height="30"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Arte" id="layer2">
    <circle id="ball" class="b" cx="70" cy="30" r="18"/>
  </g>
</svg>`;

const run = (args: string[]): string =>
  execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('cli end to end', () => {
  it('imports, animates, exports and builds a player', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sms-'));
    try {
      const drawing = join(dir, 'drawing.svg');
      writeFileSync(drawing, DRAWING);

      // 1. import
      const out = run(['import', drawing, '--out', dir]);
      assert.match(out, /Inkscape/);
      assert.match(out, /2 layer\(s\)/);
      const clean = readFileSync(join(dir, 'clean.svg'), 'utf8');
      assert.ok(!clean.includes('inkscape:'));
      assert.ok(clean.includes('fill="#ff3366"'));

      // 2. animate
      run(['animate', join(dir, 'scene.json'), '--preset', 'spin', '--target', 'ball', '--out', join(dir, 'scene2.json')]);
      const scene = JSON.parse(readFileSync(join(dir, 'scene2.json'), 'utf8'));
      assert.equal(scene.animators.length, 1, 'spin without an origin is a single rotate animator');
      assert.equal(scene.animators[0].target, 'ball');
      assert.equal(scene.animators[0].property, 'rotate');

      // 3. export SMIL
      run(['export', join(dir, 'scene2.json'), '--format', 'smil', '--out', join(dir, 'a.svg')]);
      const svg = readFileSync(join(dir, 'a.svg'), 'utf8');
      assert.ok(svg.includes('<animate'));
      assert.ok(svg.includes('id="ball"'));

      // 4. player HTML
      run(['player', join(dir, 'scene2.json'), '--out', join(dir, 'player.html')]);
      const html = readFileSync(join(dir, 'player.html'), 'utf8');
      assert.ok(html.startsWith('<!doctype html>'));
      assert.ok(html.includes('Reproduzir'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unknown preset instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sms-'));
    try {
      const drawing = join(dir, 'd.svg');
      writeFileSync(drawing, DRAWING);
      run(['import', drawing, '--out', dir]);
      assert.throws(
        () => execFileSync(process.execPath, [cli, 'animate', join(dir, 'scene.json'), '--preset', 'nope'], {
          stdio: 'pipe',
        }),
        /Command failed|unknown preset/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('doctor and info run', () => {
    assert.match(run(['doctor']), /node v\d+/);
    assert.match(run(['info']), /fade-in/);
  });
});

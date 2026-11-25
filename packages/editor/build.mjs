// Bundle the editor into a single self-contained HTML file.
//
// `npm run build` in this package produces dist/editor.html: one file with the
// CSS, the JS and no external requests, so it can be opened straight from the
// filesystem on a phone or served by `sms serve` on Termux.

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(here, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  write: false,
  legalComments: 'none',
});

const js = result.outputFiles[0].text;
const css = readFileSync(join(here, 'src/styles.css'), 'utf8');
const shell = readFileSync(join(here, 'src/index.html'), 'utf8');

const html = shell
  .replace('/* INLINE_CSS */', () => css)
  .replace('/* INLINE_JS */', () => js);

const file = join(out, 'editor.html');
writeFileSync(file, html);
console.log(`wrote ${file} (${(html.length / 1024).toFixed(1)} kB)`);

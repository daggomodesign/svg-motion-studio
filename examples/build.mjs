// Export examples/hello.* as animated SVG (SMIL and CSS) into examples/out/.
// Run from the repo root with `npm run demo`, then open the files in a browser
// (on Termux: `termux-open examples/out/hello.smil.svg`).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportCss, exportSmil } from '@svg-motion-studio/export';

const here = dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(join(here, 'hello.scene.json'), 'utf8'));
const source = readFileSync(join(here, 'hello.svg'), 'utf8');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

for (const [name, run] of [['smil', exportSmil], ['css', exportCss]]) {
  const { svg, warnings } = run(scene, { source });
  const file = join(out, `hello.${name}.svg`);
  writeFileSync(file, svg);
  console.log(`wrote ${file} (${svg.length} bytes)`);
  for (const w of warnings) console.log(`  ${w.severity}: ${w.path}: ${w.message}`);
}

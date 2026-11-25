import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAttr, parseSvg, serializeSvg, walk, type SvgElement } from '@svg-motion-studio/svg';
import { inlineStyles, parseDeclarations, parseSelector } from '../src/css.js';
import { detectTool, importSvg } from '../src/index.js';
import { normalizeCanvas, normalizeReferences, stripEditorMetadata } from '../src/normalize.js';
import { assignIds, detectLayers, readableName, sanitizeId } from '../src/structure.js';
import { parseLength, toPx } from '../src/units.js';
import { BARE_SAMPLE, CORELDRAW_SAMPLE, INKSCAPE_SAMPLE } from './fixtures.js';

describe('units', () => {
  it('parses a length with and without a unit', () => {
    assert.deepEqual(parseLength('210mm'), { value: 210, unit: 'mm' });
    assert.deepEqual(parseLength('512'), { value: 512, unit: 'px' });
    assert.deepEqual(parseLength(' 72 PT '), { value: 72, unit: 'pt' });
  });

  it('rejects relative units', () => {
    assert.equal(parseLength('100%'), undefined);
    assert.equal(parseLength('2em'), undefined);
    assert.equal(parseLength('nonsense'), undefined);
  });

  it('converts physical units to CSS pixels', () => {
    assert.equal(toPx({ value: 25.4, unit: 'mm' }), 96);
    assert.equal(toPx({ value: 1, unit: 'in' }), 96);
    assert.equal(toPx({ value: 72, unit: 'pt' }), 96);
    assert.equal(toPx({ value: 2.54, unit: 'cm' }), 96);
  });
});

describe('detectTool', () => {
  it('recognises CorelDRAW, Inkscape and bare documents', () => {
    assert.equal(detectTool(CORELDRAW_SAMPLE), 'coreldraw');
    assert.equal(detectTool(INKSCAPE_SAMPLE), 'inkscape');
    assert.equal(detectTool(BARE_SAMPLE), 'unknown');
  });
});

describe('stripEditorMetadata', () => {
  it('removes metadata elements and editor attributes', () => {
    const doc = parseSvg(INKSCAPE_SAMPLE);
    const result = stripEditorMetadata(doc);
    assert.ok(result.elements >= 1, `expected the namedview to go, got ${result.elements}`);
    assert.ok(result.attributes > 0);
    const markup = serializeSvg(doc);
    assert.ok(!markup.includes('sodipodi:namedview'));
    assert.ok(!markup.includes('inkscape:version'));
    assert.ok(!markup.includes('rdf:RDF'));
  });

  it('keeps the drawing itself intact', () => {
    const doc = parseSvg(CORELDRAW_SAMPLE);
    stripEditorMetadata(doc);
    const markup = serializeSvg(doc);
    assert.ok(markup.includes('id="dot"'));
    assert.ok(markup.includes('id="curve"'));
  });
});

describe('normalizeCanvas', () => {
  it('keeps a valid viewBox and rewrites width/height in user units', () => {
    const doc = parseSvg(CORELDRAW_SAMPLE);
    const canvas = normalizeCanvas(doc);
    assert.equal(canvas.width, 210);
    assert.equal(canvas.height, 297);
    assert.equal(canvas.derived, false);
    assert.equal(canvas.sourceUnit, 'mm');
    assert.equal(getAttr(doc.root, 'width'), '210');
    assert.equal(getAttr(doc.root, 'height'), '297');
  });

  it('derives a viewBox from the physical size when there is none', () => {
    const doc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="12.7mm"/>');
    const canvas = normalizeCanvas(doc);
    assert.equal(canvas.derived, true);
    assert.equal(canvas.width, 96);
    assert.equal(canvas.height, 48);
    assert.equal(getAttr(doc.root, 'viewBox'), '0 0 96 48');
  });

  it('falls back to the SVG default size', () => {
    const doc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const canvas = normalizeCanvas(doc);
    assert.equal(canvas.width, 300);
    assert.equal(canvas.height, 150);
  });
});

describe('normalizeReferences', () => {
  it('rewrites xlink:href as href and reports dangling references', () => {
    const doc = parseSvg(INKSCAPE_SAMPLE);
    const result = normalizeReferences(doc);
    assert.ok(result.rewritten >= 1);
    assert.deepEqual(result.dangling, []);
    const markup = serializeSvg(doc);
    assert.ok(!markup.includes('xlink:href'));
    assert.ok(markup.includes('href="#grad0"'));
  });

  it('reports a reference to a missing id', () => {
    const doc = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" fill="url(#nope)"/></svg>');
    const result = normalizeReferences(doc);
    assert.deepEqual(result.dangling, ['nope']);
  });
});

describe('css inlining', () => {
  it('parses declarations, respecting parentheses and quotes', () => {
    const decls = parseDeclarations('fill:url(#a); stroke:"x;y"; opacity:0.5 !important');
    assert.deepEqual(decls, [
      { prop: 'fill', value: 'url(#a)' },
      { prop: 'stroke', value: '"x;y"' },
      { prop: 'opacity', value: '0.5' },
    ]);
  });

  it('parses compound selectors and computes specificity', () => {
    const s = parseSelector('g.layer > rect#hero.big');
    assert.ok(s !== undefined);
    assert.deepEqual(s.specificity, [1, 2, 2]);
    assert.deepEqual(s.combinators, ['>']);
  });

  it('rejects unsupported selectors', () => {
    assert.equal(parseSelector('rect:hover'), undefined);
    assert.equal(parseSelector('[data-x]'), undefined);
  });

  it('flattens stylesheet rules into attributes', () => {
    const doc = parseSvg(INKSCAPE_SAMPLE);
    const result = inlineStyles(doc);
    assert.equal(result.styleElements, 1);
    assert.ok(result.rules >= 3);
    const markup = serializeSvg(doc);
    assert.ok(!markup.includes('<style'));
    assert.ok(markup.includes('fill="#ff3366"'));
  });

  it('lets style="…" win over the stylesheet', () => {
    const doc = parseSvg(INKSCAPE_SAMPLE);
    inlineStyles(doc);
    let hero: SvgElement | undefined;
    walk(doc, (el) => {
      if (getAttr(el, 'id') === 'hero') hero = el;
    });
    assert.ok(hero !== undefined);
    assert.equal(getAttr(hero as SvgElement, 'fill'), '#00aa88');
    assert.equal(getAttr(hero as SvgElement, 'stroke'), '#222222');
    assert.equal(getAttr(hero as SvgElement, 'style'), undefined);
  });

  it('applies descendant and child combinators', () => {
    const doc = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>g.a rect{fill:#111} g.a > circle{fill:#222}</style>' +
        '<g class="a"><rect id="r"/><g><circle id="c"/></g></g></svg>',
    );
    inlineStyles(doc);
    const ids = new Map<string, SvgElement>();
    walk(doc, (el) => {
      const id = getAttr(el, 'id');
      if (id !== undefined) ids.set(id, el);
    });
    // `g.a rect` is a descendant match; `g.a > circle` is not, because the
    // circle sits inside a nested <g>.
    assert.equal(getAttr(ids.get('r') as SvgElement, 'fill'), '#111');
    assert.equal(getAttr(ids.get('c') as SvgElement, 'fill'), undefined);
  });
});

describe('structure', () => {
  it('sanitizes ids into CSS-safe identifiers', () => {
    assert.equal(sanitizeId('Layer_x0020_1'), 'Layer_x0020_1');
    assert.equal(sanitizeId('my layer!'), 'my-layer');
    assert.equal(sanitizeId('123abc'), 'e123abc');
    assert.equal(sanitizeId('  '), '');
  });

  it('turns encoded ids into readable names', () => {
    assert.equal(readableName('Layer_x0020_1'), 'Layer 1');
    assert.equal(readableName('my-layer_name'), 'my layer name');
  });

  it('gives every animatable element a unique id', () => {
    const doc = parseSvg(BARE_SAMPLE);
    const result = assignIds(doc);
    assert.equal(result.generated, 2);
    const ids: string[] = [];
    walk(doc, (el) => {
      const id = getAttr(el, 'id');
      if (id !== undefined) ids.push(id);
    });
    assert.deepEqual(ids, ['el-1', 'el-2']);
  });

  it('keeps valid ids and rewrites duplicates', () => {
    const doc = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/><rect id="a"/><rect id="b c"/></svg>',
    );
    const result = assignIds(doc);
    assert.equal(result.sanitized, 2);
    const ids: string[] = [];
    walk(doc, (el) => {
      const id = getAttr(el, 'id');
      if (id !== undefined) ids.push(id);
    });
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids[0], 'a');
  });

  it('detects Inkscape layers by label', () => {
    const doc = parseSvg(INKSCAPE_SAMPLE);
    assignIds(doc);
    const layers = detectLayers(doc);
    assert.equal(layers.length, 2);
    assert.deepEqual(layers.map((l) => l.name), ['Background', 'Artwork']);
    assert.equal(layers[1].elements, 3);
  });

  it('reports a single layer when there are no top-level groups', () => {
    const doc = parseSvg(BARE_SAMPLE);
    const layers = detectLayers(doc);
    assert.equal(layers.length, 1);
    assert.equal(layers[0].name, 'Drawing');
  });
});

describe('importSvg', () => {
  it('imports a CorelDRAW export end to end', () => {
    const result = importSvg(CORELDRAW_SAMPLE);
    assert.equal(result.tool, 'coreldraw');
    assert.equal(result.width, 210);
    assert.equal(result.height, 297);
    assert.equal(result.scene.width, 210);
    assert.equal(result.scene.source, result.svg);
    assert.ok(result.elementIds.includes('dot'));
    assert.ok(!result.svg.includes('corel:'));
    assert.ok(!result.svg.includes('<metadata'));
    assert.ok(result.notes.some((n) => n.step === 'canvas'));
  });

  it('imports an Inkscape export end to end', () => {
    const result = importSvg(INKSCAPE_SAMPLE);
    assert.equal(result.tool, 'inkscape');
    assert.equal(result.layers.length, 2);
    assert.ok(!result.svg.includes('<style'));
    assert.ok(!result.svg.includes('sodipodi:'));
    assert.ok(result.svg.includes('fill="#00aa88"'));
    assert.equal(result.notes.filter((n) => n.severity === 'error').length, 0);
  });

  it('applies scene overrides', () => {
    const result = importSvg(BARE_SAMPLE, { scene: { duration: 5, fps: 30, loop: 'once' } });
    assert.equal(result.scene.duration, 5);
    assert.equal(result.scene.fps, 30);
    assert.equal(result.scene.loop, 'once');
  });

  it('can skip individual steps', () => {
    const result = importSvg(INKSCAPE_SAMPLE, { inlineCss: false, stripMetadata: false });
    assert.ok(result.svg.includes('<style'));
    assert.ok(result.svg.includes('sodipodi:'));
  });

  it('reports an error for a document with nothing to animate', () => {
    const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    assert.ok(result.notes.some((n) => n.severity === 'error'));
  });
});

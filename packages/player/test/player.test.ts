import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderPlayerHtml } from '../src/index.js';
import { compileScene } from '@svg-motion-studio/core';
import { PRESETS } from '@svg-motion-studio/presets';

/** A minimal but complete scene with one animated rectangle. */
function sampleScene() {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect id="box" x="10" y="10" width="40" height="40" fill="#ff3366"/></svg>';
  const animators = PRESETS.find((p) => p.id === 'fade-in')!.build('box', {});
  return {
    version: 1 as const,
    width: 100,
    height: 100,
    duration: 1,
    fps: 60,
    loop: 'loop' as const,
    source,
    animators,
  };
}

describe('renderPlayerHtml', () => {
  it('produces one self-contained HTML document', () => {
    const result = renderPlayerHtml(sampleScene());
    assert.ok(result.html.startsWith('<!doctype html>'));
    assert.ok(result.html.includes('</html>'));
    assert.ok(result.html.includes('<svg'));
    assert.ok(result.html.includes('id="box"'));
    // No external requests of any kind.
    assert.ok(!/<script[^>]+src=/.test(result.html));
    assert.ok(!/<link[^>]+href=/.test(result.html));
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(result.html));
  });

  it('inlines the animation, not a reference to it', () => {
    const result = renderPlayerHtml(sampleScene(), { format: 'smil' });
    assert.ok(result.svg.includes('<animate'));
    assert.ok(result.html.includes('<animate'));
  });

  it('can export CSS animations instead', () => {
    const result = renderPlayerHtml(sampleScene(), { format: 'css' });
    assert.ok(result.svg.includes('@keyframes') || result.svg.includes('animation'));
  });

  it('includes accessible controls by default', () => {
    const result = renderPlayerHtml(sampleScene());
    assert.ok(result.html.includes('aria-label="Reproduzir"'));
    assert.ok(result.html.includes('aria-label="Repetir do início"'));
    assert.ok(result.html.includes('Controlos de reprodução'));
    assert.ok(result.html.includes('aria-label="Reproduzir"'));
  });

  it('can omit the controls entirely', () => {
    const result = renderPlayerHtml(sampleScene(), { controls: false });
    assert.ok(!result.html.includes('Controlos de reprodução'));
    assert.ok(!result.html.includes('<script>'));
  });

  it('escapes the title', () => {
    const result = renderPlayerHtml(sampleScene(), { title: '<script>alert(1)</script>' });
    assert.ok(!result.html.includes('<title><script>'));
    assert.ok(result.html.includes('&lt;script&gt;'));
  });

  it('respects reduced motion', () => {
    const result = renderPlayerHtml(sampleScene());
    assert.ok(result.html.includes('prefers-reduced-motion'));
  });

  it('is deterministic', () => {
    const a = renderPlayerHtml(sampleScene());
    const b = renderPlayerHtml(sampleScene());
    assert.equal(a.html, b.html);
  });

  it('reports export warnings without throwing', () => {
    const scene = sampleScene();
    const result = renderPlayerHtml(scene);
    assert.ok(Array.isArray(result.warnings));
  });

  it('still produces a valid scene that compiles', () => {
    const scene = sampleScene();
    const compiled = compileScene(scene);
    assert.ok(compiled.animators.length > 0);
  });
});

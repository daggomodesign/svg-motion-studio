import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendChild,
  createCData,
  createElement,
  decodeEntities,
  findById,
  getAttr,
  indexIds,
  parseSvg,
  removeAttr,
  serializeSvg,
  setAttr,
  SvgParseError,
  walk,
} from '../src/index.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [
  <!ENTITY ns_svg "http://www.w3.org/2000/svg">
]>
<!-- made by hand -->
<svg xmlns="&ns_svg;" viewBox='0 0 10 10'>
  <style><![CDATA[ .a > b { fill: red } ]]></style>
  <g id="g1" data-x="a &amp; b &lt; c &#x41;">
    <rect id="r" width="5" height="5"/>
    <text>Tom &amp; Jerry</text>
    <g></g>
  </g>
</svg>
<!-- trailing -->
`;

test('parse → serialize is lossless', () => {
  assert.equal(serializeSvg(parseSvg(SAMPLE)), SAMPLE);
});

test('a leading byte-order mark is dropped', () => {
  assert.equal(serializeSvg(parseSvg('\uFEFF<svg/>')), '<svg/>');
});

test('attributes decode on read and escape on write', () => {
  const doc = parseSvg(SAMPLE);
  const g = findById(doc, 'g1');
  assert.ok(g);
  assert.equal(getAttr(g, 'data-x'), 'a & b < c A');
  assert.equal(getAttr(doc.root, 'xmlns'), '&ns_svg;'); // unknown entity kept
  setAttr(g, 'title', 'say "hi" & <bye>');
  assert.match(serializeSvg(g), /title="say &quot;hi&quot; &amp; &lt;bye>"/);
  assert.equal(getAttr(g, 'title'), 'say "hi" & <bye>');
  assert.equal(removeAttr(g, 'title'), true);
  assert.equal(getAttr(g, 'title'), undefined);
});

test('decodeEntities handles numeric references and leaves junk alone', () => {
  assert.equal(decodeEntities('&#65;&#x42;&lt;&foo;&#0;'), 'AB<&foo;&#0;');
});

test('self-closing elements open up when they get children', () => {
  const doc = parseSvg('<svg><rect id="r"/></svg>');
  const r = findById(doc, 'r');
  assert.ok(r);
  appendChild(r, createElement('animate', { attributeName: 'x', dur: '1s' }));
  assert.equal(serializeSvg(doc), '<svg><rect id="r"><animate attributeName="x" dur="1s"/></rect></svg>');
});

test('CDATA bodies cannot terminate early', () => {
  assert.equal(serializeSvg(createCData('a ]]> b')), '<![CDATA[a ]]]]><![CDATA[> b]]>');
});

test('walk visits elements in document order and can skip subtrees', () => {
  const doc = parseSvg('<svg><g id="a"><rect id="b"/></g><circle id="c"/></svg>');
  const seen: string[] = [];
  walk(doc, (el) => {
    seen.push(el.name);
    if (el.name === 'g') return false;
  });
  assert.deepEqual(seen, ['svg', 'g', 'circle']);
  assert.deepEqual([...indexIds(doc).keys()], ['a', 'b', 'c']);
});

test('malformed markup fails with a line and column', () => {
  const cases: [string, RegExp][] = [
    ['<svg>\n  <g></svg>', /mismatched closing tag <\/svg>, expected <\/g> \(line 2, column 6\)/],
    ['<svg><g>', /unclosed tag <g>/],
    ['<html/>', /root element must be <svg>/],
    ['<svg a=1/>', /needs a quoted value/],
    ['<svg a="1" a="2"/>', /duplicate attribute a/],
    ['<svg a="1"b="2"/>', /expected whitespace/],
    ['<svg/><svg/>', /more than one root/],
    ['<svg><!-- x</svg>', /unterminated comment/],
  ];
  for (const [markup, message] of cases) {
    assert.throws(() => parseSvg(markup), (e: unknown) => e instanceof SvgParseError && message.test(e.message), markup);
  }
});

test('prefixed root and namespaced attributes are accepted', () => {
  const doc = parseSvg('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:use xlink:href="#a"/></svg:svg>');
  assert.equal(doc.root.name, 'svg:svg');
});

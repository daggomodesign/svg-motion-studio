/**
 * A CorelDRAW-style export: millimetre canvas, `corel:` metadata, a
 * `<sodipodi:namedview>`-free but RDF-bearing `<metadata>`, `i:` namespace,
 * `Layer_x0020_1` ids and `style="…"` attributes.
 */
export const CORELDRAW_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: CorelDRAW 24.0 -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/"
     xmlns:corel="http://corel.com/coreldraw"
     version="1.1" width="210mm" height="297mm" viewBox="0 0 210 297">
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <cc:Work xmlns:cc="http://creativecommons.org/ns#" rdf:about="">
        <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Poster</dc:title>
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <g id="Layer_x0020_1" corel:layer="1">
    <rect id="_x0020_rect" x="20" y="20" width="170" height="120" style="fill:#ff3366;stroke:none"/>
    <circle id="dot" cx="105" cy="200" r="18" style="fill:#222222"/>
    <path id="curve" d="M20 250 C 60 220, 150 280, 190 250" style="fill:none;stroke:#222222;stroke-width:2"/>
  </g>
</svg>`;

/**
 * An Inkscape-style export: `sodipodi:namedview`, `inkscape:label` layers,
 * a `<style>` block with class selectors, `xlink:href` on a gradient and a
 * `style="…"` attribute that must win over the stylesheet.
 */
export const INKSCAPE_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="100mm" height="100mm" viewBox="0 0 100 100" version="1.1"
     inkscape:version="1.3" sodipodi:docname="logo.svg">
  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" inkscape:zoom="1.5"/>
  <defs>
    <linearGradient id="grad1" xlink:href="#grad0"/>
    <linearGradient id="grad0">
      <stop id="stop1" offset="0" style="stop-color:#ff3366"/>
      <stop id="stop2" offset="1" style="stop-color:#3366ff"/>
    </linearGradient>
  </defs>
  <style type="text/css"><![CDATA[
    .fil0 { fill: #ff3366; }
    .str0 { stroke: #222222; stroke-width: 1.5; }
    #hero { fill: #00aa88; }
  ]]></style>
  <g inkscape:groupmode="layer" inkscape:label="Background" id="layer1">
    <rect id="bg" class="fil0" x="0" y="0" width="100" height="100"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Artwork" id="layer2">
    <circle id="hero" class="fil0 str0" cx="50" cy="50" r="30" style="fill:#00aa88"/>
    <path id="swoosh" class="str0" d="M10 80 Q 50 40 90 80" style="fill:none"/>
  </g>
</svg>`;

/** A minimal document with no ids, no viewBox and no units. */
export const BARE_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
  <rect x="10" y="10" width="100" height="50" fill="#123456"/>
  <circle cx="200" cy="150" r="40" fill="#abcdef"/>
</svg>`;

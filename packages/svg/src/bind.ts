/**
 * Binding: resolve each animator of a scene to the SVG element it drives.
 */

import type { PropertyName, Scene, SceneIssue } from '@svg-motion-studio/core';
import { indexIds } from './dom.js';
import { localName, type SvgDocument, type SvgElement } from './xml.js';

/** Result of {@link bindScene}. */
export interface SceneBinding {
  /** Animator id → bound element, for every animator whose target exists. */
  readonly elements: ReadonlyMap<string, SvgElement>;
  /** Missing targets and suspicious bindings (all warnings). */
  readonly issues: readonly SceneIssue[];
}

/** Elements on which an attribute-like property has an effect. Others accept any element. */
const APPLIES_TO: Partial<Record<PropertyName, readonly string[]>> = {
  'stop-color': ['stop'],
  offset: ['stop'],
  d: ['path'],
  cx: ['circle', 'ellipse', 'radialGradient'],
  cy: ['circle', 'ellipse', 'radialGradient'],
  r: ['circle', 'radialGradient'],
  rx: ['ellipse', 'rect'],
  ry: ['ellipse', 'rect'],
  x: ['rect', 'image', 'use', 'text', 'tspan', 'svg', 'foreignObject', 'pattern', 'mask', 'filter'],
  y: ['rect', 'image', 'use', 'text', 'tspan', 'svg', 'foreignObject', 'pattern', 'mask', 'filter'],
  width: ['rect', 'image', 'use', 'svg', 'foreignObject', 'pattern', 'mask', 'filter'],
  height: ['rect', 'image', 'use', 'svg', 'foreignObject', 'pattern', 'mask', 'filter'],
};

/**
 * Resolve animator targets (and click/hover listener targets) against the
 * element ids of `doc`. Never throws: problems come back as warnings, and
 * animators without a target are simply left out of `elements`.
 */
export function bindScene(doc: SvgDocument, scene: Scene): SceneBinding {
  const ids = indexIds(doc);
  const elements = new Map<string, SvgElement>();
  const issues: SceneIssue[] = [];

  scene.animators.forEach((a, i) => {
    const base = `animators/${i}`;
    const el = ids.get(a.target);
    if (el === undefined) {
      issues.push({ severity: 'warning', path: `${base}/target`, message: `no element with id "${a.target}"; animator "${a.id}" is skipped` });
      return;
    }
    elements.set(a.id, el);

    const allowed = APPLIES_TO[a.property];
    if (allowed !== undefined && !allowed.includes(localName(el.name))) {
      issues.push({
        severity: 'warning',
        path: `${base}/property`,
        message: `"${a.property}" has no effect on <${localName(el.name)}> (expected ${allowed.map((x) => `<${x}>`).join(', ')})`,
      });
    }

    const trigger = a.trigger;
    if ((trigger?.type === 'click' || trigger?.type === 'hover') && trigger.target !== undefined && !ids.has(trigger.target)) {
      issues.push({ severity: 'warning', path: `${base}/trigger/target`, message: `no element with id "${trigger.target}" to listen on` });
    }
  });

  return { elements, issues };
}

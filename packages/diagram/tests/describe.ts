#!/usr/bin/env node
/**
 * describeScene() against a hand-drawn scene.
 *
 * Round-tripping the generator's own output proves nothing here, because the
 * generator always binds text to its container. Humans mostly do not — they
 * drop a label on top of a shape — so this fixture reproduces that shape and
 * asserts the labels are still recovered.
 */
import { describeScene } from '../src/describe';
import type { ExcalidrawElement } from '../src/types';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  — ${detail}`}`);
  if (!pass) failures++;
}

const base = {
  angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [],
  frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false, index: 'a0',
};

const scene: ExcalidrawElement[] = [
  // Two boxes with labels merely placed on top — no containerId, no boundElements.
  { ...base, id: 'boxA', type: 'rectangle', x: 0, y: 0, width: 200, height: 80 },
  { ...base, id: 'txtA', type: 'text', x: 40, y: 30, width: 120, height: 25, text: 'prompt', originalText: 'prompt' },
  { ...base, id: 'boxB', type: 'rectangle', x: 0, y: 300, width: 200, height: 80 },
  { ...base, id: 'txtB', type: 'text', x: 40, y: 330, width: 120, height: 25, text: 'response', originalText: 'response' },
  // An arrow bound to both boxes, with its label floating near the midpoint.
  {
    ...base, id: 'arr', type: 'arrow', x: 100, y: 80, width: 0, height: 220,
    points: [[0, 0], [0, 220]],
    startBinding: { elementId: 'boxA', focus: 0, gap: 4 },
    endBinding: { elementId: 'boxB', focus: 0, gap: 4 },
  },
  { ...base, id: 'txtArr', type: 'text', x: 110, y: 180, width: 60, height: 20, text: 'loop', originalText: 'loop' },
  // Genuinely loose: a title far from anything.
  { ...base, id: 'title', type: 'text', x: 0, y: -120, width: 300, height: 35, text: 'Agent Harness', originalText: 'Agent Harness' },
];

const out = describeScene(scene);

check('shape label recovered from unbound text inside it (boxA)',
  out.shapes.find((s) => s.id === 'boxA')?.label === 'prompt',
  JSON.stringify(out.shapes.find((s) => s.id === 'boxA')));

check('shape label recovered for boxB',
  out.shapes.find((s) => s.id === 'boxB')?.label === 'response');

check('edge endpoints resolve to labels, not raw ids',
  out.edges[0]?.from === 'prompt' && out.edges[0]?.to === 'response',
  JSON.stringify(out.edges[0]));

check('arrow label recovered from nearby floating text',
  out.edges[0]?.label === 'loop', JSON.stringify(out.edges[0]));

check('adopted labels are removed from looseText',
  !out.looseText.includes('prompt') && !out.looseText.includes('loop'),
  JSON.stringify(out.looseText));

check('genuinely loose text is still reported',
  out.looseText.includes('Agent Harness'), JSON.stringify(out.looseText));

process.exit(failures > 0 ? 1 : 0);

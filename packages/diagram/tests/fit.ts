#!/usr/bin/env node
/**
 * growBoxesToFitText() against the shape a hand-drawn diagram actually has.
 *
 * The generator binds every label to its container, so its own output can never
 * exercise this. People do not: they drop text on top of a box, leaving it
 * structurally unrelated — and that is precisely the case where longer text
 * overflows with nothing to regrow it.
 */
import { growBoxesToFitText } from '../src/fit';
import type { ExcalidrawElement } from '../src/types';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  — ${detail}`}`);
  if (!pass) failures++;
}

const base = {
  angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [],
  frameId: null, roundness: null, seed: 1, version: 3, versionNonce: 1, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false, index: 'a0',
};

function scene(): ExcalidrawElement[] {
  return [
    // An outer region and an inner box, to check the smallest one wins.
    { ...base, id: 'region', type: 'rectangle', x: 0, y: 0, width: 600, height: 400 },
    { ...base, id: 'box', type: 'rectangle', x: 40, y: 40, width: 200, height: 80 },
    // Unbound text sitting on the inner box, now three lines tall.
    { ...base, id: 'txt', type: 'text', x: 50, y: 50, width: 180, height: 75, text: 'a\nb\nc', containerId: null },
    // A far-away box that must not be touched.
    { ...base, id: 'elsewhere', type: 'rectangle', x: 900, y: 900, width: 100, height: 50 },
  ] as ExcalidrawElement[];
}

// 1. The containing box grows to fit.
let els = scene();
let resizes = growBoxesToFitText(els, new Set(['txt']));
const box = els.find((e) => e.id === 'box')!;
check('the smallest containing box grows', box.height === 50 - 40 + 75 + 16, `height=${box.height}`);
check('one resize reported', resizes.length === 1 && resizes[0].shapeId === 'box', JSON.stringify(resizes));

// 2. The outer region and unrelated shapes are untouched.
check('the enclosing region is not resized', els.find((e) => e.id === 'region')!.height === 400);
check('an unrelated box is not resized', els.find((e) => e.id === 'elsewhere')!.height === 50);

// 3. Text that already fits changes nothing.
els = scene();
(els.find((e) => e.id === 'txt') as ExcalidrawElement).height = 20;
resizes = growBoxesToFitText(els, new Set(['txt']));
check('a box that already fits is left alone', resizes.length === 0 && els.find((e) => e.id === 'box')!.height === 80);

// 4. Boxes are never shrunk.
els = scene();
(els.find((e) => e.id === 'txt') as ExcalidrawElement).height = 5;
growBoxesToFitText(els, new Set(['txt']));
check('boxes are never shrunk', els.find((e) => e.id === 'box')!.height === 80);

// 5. Bound text is left to Excalidraw.
els = scene();
(els.find((e) => e.id === 'txt') as ExcalidrawElement).containerId = 'box';
resizes = growBoxesToFitText(els, new Set(['txt']));
check('bound text is skipped', resizes.length === 0, JSON.stringify(resizes));

// 6. Untouched text is ignored even if it overflows.
els = scene();
resizes = growBoxesToFitText(els, new Set());
check('text that was not edited is ignored', resizes.length === 0);

process.exit(failures > 0 ? 1 : 0);

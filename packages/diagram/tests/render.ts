#!/usr/bin/env node
/**
 * renderSvg() — the SVG behind screenshot_sheet and preview_diagram.
 *
 * Pixels are checked by the MCP smoke test; this checks the things that would
 * make a screenshot quietly lie: elements missing, deleted ones drawn, text in
 * the wrong face, arrow labels struck through.
 */
import { buildDiagram } from '../src/index';
import { renderSvg } from '../src/render';
import type { ExcalidrawElement } from '../src/types';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  — ${detail}`}`);
  if (!pass) failures++;
}

const { scene } = buildDiagram({
  title: 'Render <check> & escape',
  nodes: [
    { id: 'a', label: 'Client', shape: 'ellipse', accent: 'blue' },
    { id: 'b', label: 'Decide', shape: 'diamond' },
    { id: 'c', label: 'Store' },
  ],
  edges: [
    { from: 'a', to: 'b', label: 'calls' },
    { from: 'b', to: 'c', style: 'dashed' },
  ],
});
const els = scene.elements as ExcalidrawElement[];
const { svg, bounds } = renderSvg(els, scene.appState);

check('one ellipse', (svg.match(/<ellipse /g) ?? []).length === 1);
check('diamond drawn as a polygon', svg.includes('<polygon points='));
check('two arrows, each with a head', (svg.match(/<path d="M/g) ?? []).length === 2 &&
  (svg.match(/<polyline /g) ?? []).length === 2);
check('dashed edge keeps its dash', svg.includes('stroke-dasharray'));
check('fill colour carried', svg.includes('#a5d8ff'));
check('text uses Excalifont', svg.includes('font-family="Excalifont"'));
check('every label present', ['Client', 'Decide', 'Store', 'calls'].every((t) => svg.includes(t)));
check('text is escaped', svg.includes('Render &lt;check&gt; &amp; escape') && !svg.includes('<check>'));
check('arrow label sits on a plate', /<rect [^>]*fill="#ffffff"\/><text[^>]*><tspan[^>]*>calls/.test(svg));
check('bounds are non-empty', bounds.width > 100 && bounds.height > 100, JSON.stringify(bounds));

const ghost = { ...els.find((e) => e.type === 'rectangle')!, id: 'ghost', isDeleted: true, backgroundColor: '#123456' };
check('deleted elements are not drawn', !renderSvg([...els, ghost]).svg.includes('#123456'));

check('empty scene has empty bounds', renderSvg([]).bounds.width === 0);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');

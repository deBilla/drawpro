#!/usr/bin/env node
/**
 * Turn a diagram spec into an .excalidraw file.
 *
 *   npx tsx packages/diagram/src/cli.ts <spec.json> [out.excalidraw]
 *
 * Validation issues go to stderr and errors exit non-zero, so a caller can read
 * the messages, correct the spec, and retry rather than shipping a bad diagram.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDiagram } from './index';
import type { DiagramSpec } from './types';

function main(argv: string[]): number {
  const [specPath, outPath] = argv;
  if (!specPath) {
    console.error('usage: cli.ts <spec.json> [out.excalidraw]');
    return 2;
  }

  let spec: DiagramSpec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8')) as DiagramSpec;
  } catch (err) {
    console.error(`Could not read spec: ${(err as Error).message}`);
    return 2;
  }

  const { scene, issues } = buildDiagram(spec);

  for (const issue of issues) {
    console.error(`${issue.level === 'error' ? 'error' : 'warning'}: ${issue.message}`);
  }
  if (issues.some((i) => i.level === 'error')) {
    return 1;
  }

  const target = outPath ?? specPath.replace(/\.json$/, '') + '.excalidraw';
  writeFileSync(target, JSON.stringify(scene, null, 2));
  console.log(`${target}  (${scene.elements.length} elements)`);
  return 0;
}

process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
/**
 * Golden-file tests for the generator.
 *
 *   npx tsx packages/diagram/tests/golden.ts            compare (exit 1 on diff)
 *   npx tsx packages/diagram/tests/golden.ts --update    re-bless the goldens
 *
 * Every scene carries random ids, seeds, nonces, and a timestamp, so raw output
 * differs on every run. normalize() below makes it comparable — and rather than
 * dropping ids, it renumbers them in array order and rewrites every reference,
 * so the *binding structure* stays visible in the golden file. A broken
 * containerId or arrow binding therefore shows up as a diff rather than
 * silently normalising away.
 *
 * These catch "did anything change?". They cannot tell you the output is
 * correct — a wrong diagram blessed once stays blessed. Pair them with the
 * assertions in validate.ts, which say "this is wrong".
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildDiagram } from '../src/index';
import type { DiagramSpec, ExcalidrawElement } from '../src/types';

const HERE = dirname(__filename);
const CASES = join(HERE, 'cases');
const GOLDEN = join(HERE, 'golden');

/** Fields that legitimately differ on every run and carry no meaning. */
const VOLATILE = new Set(['seed', 'versionNonce', 'updated', 'version']);

function normalize(elements: ExcalidrawElement[]): unknown[] {
  const idMap = new Map(elements.map((el, i) => [el.id, `el${String(i).padStart(2, '0')}`]));
  const remap = (id: unknown) => (typeof id === 'string' && idMap.has(id) ? idMap.get(id) : id);

  return elements.map((el) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(el)) {
      if (VOLATILE.has(key)) continue;
      if (key === 'id' || key === 'containerId' || key === 'frameId') {
        out[key] = remap(value);
      } else if (key === 'boundElements' && Array.isArray(value)) {
        out[key] = value.map((b) => ({ ...(b as object), id: remap((b as { id: string }).id) }));
      } else if ((key === 'startBinding' || key === 'endBinding') && value) {
        const b = value as { elementId: string };
        out[key] = { ...b, elementId: remap(b.elementId) };
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

function firstDifference(a: string, b: string): string {
  const left = a.split('\n');
  const right = b.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(left.length, right.length) && out.length < 12; i++) {
    if (left[i] !== right[i]) {
      out.push(`    line ${i + 1}`);
      out.push(`      - ${left[i] ?? '(end of file)'}`);
      out.push(`      + ${right[i] ?? '(end of file)'}`);
    }
  }
  return out.join('\n');
}

function main(): number {
  const update = process.argv.includes('--update');
  const names = readdirSync(CASES).filter((f) => f.endsWith('.json'));
  let failed = 0;

  for (const file of names) {
    const name = file.replace(/\.json$/, '');
    const spec = JSON.parse(readFileSync(join(CASES, file), 'utf8')) as DiagramSpec;
    const { scene, issues } = buildDiagram(spec);

    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length > 0) {
      console.log(`  FAIL  ${name} — generator reported ${errors.length} error(s)`);
      for (const e of errors.slice(0, 3)) console.log(`          ${e.message}`);
      failed++;
      continue;
    }

    const actual = JSON.stringify(normalize(scene.elements), null, 2) + '\n';
    const goldenPath = join(GOLDEN, `${name}.golden.json`);

    if (update || !existsSync(goldenPath)) {
      const isNew = !existsSync(goldenPath);
      const changed = !isNew && readFileSync(goldenPath, 'utf8') !== actual;
      writeFileSync(goldenPath, actual);
      console.log(`  ${isNew ? 'NEW ' : changed ? 'UPD ' : 'SAME'}  ${name}`);
      continue;
    }

    const expected = readFileSync(goldenPath, 'utf8');
    if (expected === actual) {
      console.log(`  PASS  ${name} (${scene.elements.length} elements)`);
    } else {
      console.log(`  FAIL  ${name} — output differs from golden`);
      console.log(firstDifference(expected, actual));
      failed++;
    }
  }

  if (failed > 0) {
    console.log(`\n  ${failed} case(s) differ. If the change is intended, review the diff above,`);
    console.log('  then re-bless with:  npx tsx packages/diagram/tests/golden.ts --update');
  }
  return failed > 0 ? 1 : 0;
}

process.exit(main());

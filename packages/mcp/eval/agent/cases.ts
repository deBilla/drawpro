import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDiagram } from '@drawpro/diagram';
import type { Env } from '../harness';

/**
 * The agent cases, read from `plugin/evals/` so there is exactly one copy.
 *
 * Those prompts and graders were written for `claude plugin eval`, which is in
 * early access. Rather than maintain a second set, this runner drives the same
 * files through the Claude API — so if access is granted later, both runners
 * are measuring the same thing and their numbers are comparable.
 */

const EVALS_DIR = join(__dirname, '../../plugin/evals');

export interface AgentCase {
  id: string;
  prompt: string;
  /** One rubric per grader file. Each is judged independently. */
  graders: { name: string; rubric: string }[];
  /** Puts the account into the state the prompt assumes. */
  setup?: (env: Env) => Promise<void>;
}

function loadCase(id: string, setup?: AgentCase['setup']): AgentCase {
  const dir = join(EVALS_DIR, id);
  const graderDir = join(dir, 'graders');
  return {
    id,
    prompt: readFileSync(join(dir, 'prompt.md'), 'utf8').trim(),
    graders: readdirSync(graderDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({
        name: f.replace(/\.md$/, ''),
        rubric: readFileSync(join(graderDir, f), 'utf8').trim(),
      })),
    setup,
  };
}

/** The architecture sheet `read-then-extend` expects to already be there. */
async function seedArchitecture(env: Env): Promise<void> {
  const { scene } = buildDiagram({
    title: 'Architecture',
    nodes: [
      { id: 'browser', label: 'Browser' },
      { id: 'nginx', label: 'nginx :80' },
      { id: 'api', label: 'API :3001' },
      { id: 'pg', label: 'Postgres 17', shape: 'ellipse' },
      { id: 'redis', label: 'Redis', shape: 'ellipse' },
    ],
    edges: [
      { from: 'browser', to: 'nginx', label: 'ciphertext only' },
      { from: 'nginx', to: 'api' },
      { from: 'api', to: 'pg' },
      { from: 'api', to: 'redis' },
    ],
  });
  await env.seed('Architecture', scene.elements);
}

export function loadCases(): AgentCase[] {
  return [
    loadCase('create-from-description'),
    loadCase('self-correction'),
    loadCase('read-then-extend', seedArchitecture),
  ];
}

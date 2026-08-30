#!/usr/bin/env node
/**
 * The LLM-judged eval suite.
 *
 *   ANTHROPIC_API_KEY=... npm run eval:agent --workspace @drawpro/mcp
 *   npm run eval:agent --workspace @drawpro/mcp -- --arms with,without --cases self-correction
 *
 * Drives a real model through a real MCP session and judges the transcript
 * against the rubrics in `plugin/evals/`. This answers the question the
 * deterministic suite cannot: does a model, given only the prompt, actually
 * reach for the right tool and recover when it gets one wrong?
 *
 * It runs against the same hermetic fake account, so it needs an API key and
 * nothing else — no DrawPro account, no live diagrams in a prompt. It costs
 * money per run, so it is not a CI gate; the deterministic suite is.
 *
 * The `without` arm gives the model a file-writing tool instead of the MCP
 * server, which is what it would do unaided. The delta between the arms is the
 * number that says whether this package earns the context it occupies — a
 * plugin that does not beat the baseline is not worth installing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEnv, type Env } from '../harness';
import { loadCases, type AgentCase } from './cases';

const MODEL = process.env.DRAWPRO_EVAL_MODEL ?? 'claude-opus-5';
const JUDGE_MODEL = process.env.DRAWPRO_EVAL_JUDGE ?? 'claude-opus-5';
const MAX_TURNS = 14;

type Arm = 'with' | 'without';

interface TurnRecord {
  tool: string;
  input: unknown;
  result: string;
}

interface CaseRun {
  case: string;
  arm: Arm;
  transcript: string;
  turns: TurnRecord[];
  finalState: string;
  error?: string;
  verdicts: { grader: string; pass: boolean; reason: string }[];
}

const client = new Anthropic();

// ─── Tool surfaces ───────────────────────────────────────────────────────────

/** The MCP server's own tools, translated into Anthropic tool definitions. */
async function mcpTools(env: Env): Promise<Anthropic.Tool[]> {
  const { tools } = await env.client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

/**
 * The baseline arm: no DrawPro tools, just a filesystem.
 *
 * This is deliberately what an unaided model reaches for — hand-written
 * Excalidraw JSON saved to disk. Grading it against the same rubrics is what
 * makes the comparison honest rather than rhetorical.
 */
function fileTools(scratch: string): Anthropic.Tool[] {
  return [
    {
      name: 'write_file',
      description:
        'Write a file to disk. Use this to save a diagram file the user can open.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: `Path under ${scratch}` },
          contents: { type: 'string' },
        },
        required: ['path', 'contents'],
      },
    },
  ];
}

// ─── One run ─────────────────────────────────────────────────────────────────

async function runCase(testCase: AgentCase, arm: Arm): Promise<CaseRun> {
  const env = await startEnv();
  const scratch = mkdtempSync(join(tmpdir(), 'drawpro-agent-'));
  const turns: TurnRecord[] = [];
  const transcript: string[] = [];

  try {
    await testCase.setup?.(env);

    const tools = arm === 'with' ? await mcpTools(env) : fileTools(scratch);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: testCase.prompt },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        tools,
        messages,
      });

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          transcript.push(`ASSISTANT: ${block.text.trim()}`);
        }
      }

      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        transcript.push(`TOOL CALL: ${block.name}\n${JSON.stringify(block.input, null, 2)}`);

        let output: string;
        if (arm === 'with') {
          output = await env.call(block.name, block.input as Record<string, unknown>);
        } else {
          const input = block.input as { path: string; contents: string };
          const safe = join(scratch, input.path.replace(/^.*\//, ''));
          writeFileSync(safe, input.contents);
          output = `Wrote ${input.contents.length} bytes to ${safe}`;
        }

        transcript.push(`TOOL RESULT: ${output.slice(0, 2000)}`);
        turns.push({ tool: block.name, input: block.input, result: output.slice(0, 4000) });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: output.slice(0, 8000) });
      }

      messages.push({ role: 'user', content: results });
    }

    // What the account actually holds afterwards. Grading the artefact matters
    // more than grading the narration — a model can describe a diagram it never
    // created, and several of these rubrics exist because that happened.
    const finalState = await describeAccount(env);

    return { case: testCase.id, arm, transcript: transcript.join('\n\n'), turns, finalState, verdicts: [] };
  } catch (err) {
    return {
      case: testCase.id,
      arm,
      transcript: transcript.join('\n\n'),
      turns,
      finalState: '(run failed before the account could be inspected)',
      error: (err as Error).message,
      verdicts: [],
    };
  } finally {
    await env.close();
  }
}

async function describeAccount(env: Env): Promise<string> {
  const lines: string[] = [];
  for (const [id, sheet] of env.api.sheets) {
    if (!sheet.encryptedData) continue;
    try {
      const scene = await env.open(id);
      const labels = (scene.elements as any[])
        .filter((e) => e.type === 'text' && e.originalText)
        .map((e) => e.originalText);
      lines.push(
        `sheet ${id}: name="${scene.name}", ${scene.elements.length} elements, labels: ${labels.join(' | ')}`,
      );
    } catch {
      lines.push(`sheet ${id}: could not be decrypted`);
    }
  }
  return lines.length ? lines.join('\n') : '(the account contains no sheets)';
}

// ─── Judging ─────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are grading one run of an agent evaluation.

You are given a rubric, the transcript of the run, and the state of the user's
account afterwards. Apply the rubric exactly as written — it states its own PASS
and FAIL conditions, and those override any opinion you have about what good
work looks like.

Two standing rules:
- Grade outcomes, not phrasing. Never fail a run for wording, shape, or colour
  choices unless the rubric explicitly asks about them.
- The account state is authoritative. If the transcript claims something was
  created and the account state does not show it, that is a FAIL.

Reply with a single JSON object and nothing else:
{"pass": true|false, "reason": "<one sentence, max 30 words>"}`;

async function judge(run: CaseRun, grader: { name: string; rubric: string }): Promise<{
  grader: string;
  pass: boolean;
  reason: string;
}> {
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: JUDGE_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `# Rubric\n\n${grader.rubric}\n\n` +
          `# Transcript\n\n${run.transcript || '(the model made no tool calls and said nothing)'}\n\n` +
          `# Account state afterwards\n\n${run.finalState}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // The judge is instructed to return bare JSON; tolerate a code fence anyway
  // rather than throwing away a paid call over formatting.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { grader: grader.name, pass: false, reason: `unparseable verdict: ${text.slice(0, 100)}` };

  try {
    const parsed = JSON.parse(match[0]) as { pass: boolean; reason: string };
    return { grader: grader.name, pass: Boolean(parsed.pass), reason: String(parsed.reason ?? '') };
  } catch {
    return { grader: grader.name, pass: false, reason: `unparseable verdict: ${text.slice(0, 100)}` };
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main(): Promise<number> {
  const arms = flag('arms', 'with,without').split(',') as Arm[];
  const only = flag('cases', '');
  const cases = loadCases().filter((c) => !only || only.split(',').includes(c.id));

  console.log(`\nDrawPro MCP — agent eval`);
  console.log(`model ${MODEL}, judge ${JUDGE_MODEL}, arms: ${arms.join(' + ')}\n`);

  const runs: CaseRun[] = [];

  for (const testCase of cases) {
    for (const arm of arms) {
      process.stdout.write(`  ${testCase.id} [${arm}] ... `);
      const run = await runCase(testCase, arm);
      run.verdicts = await Promise.all(testCase.graders.map((g) => judge(run, g)));
      runs.push(run);

      const passed = run.verdicts.filter((v) => v.pass).length;
      console.log(`${passed}/${run.verdicts.length}${run.error ? `  (error: ${run.error})` : ''}`);
      for (const v of run.verdicts) {
        console.log(`      ${v.pass ? 'pass' : 'FAIL'}  ${v.grader} — ${v.reason}`);
      }
    }
    console.log('');
  }

  const score = (arm: Arm) => {
    const relevant = runs.filter((r) => r.arm === arm).flatMap((r) => r.verdicts);
    return { passed: relevant.filter((v) => v.pass).length, total: relevant.length };
  };

  const summary: Record<string, { passed: number; total: number }> = {};
  for (const arm of arms) summary[arm] = score(arm);

  for (const arm of arms) {
    const s = summary[arm];
    const pct = s.total ? Math.round((s.passed / s.total) * 100) : 0;
    console.log(`${arm.padEnd(8)} ${s.passed}/${s.total} (${pct}%)`);
  }

  if (arms.includes('with') && arms.includes('without')) {
    const delta = summary.with.passed - summary.without.passed;
    console.log(`\ndelta ${delta >= 0 ? '+' : ''}${delta} checks with the plugin installed`);
  }

  writeFileSync(
    join(__dirname, '../agent-results.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), model: MODEL, judge: JUDGE_MODEL, summary, runs },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nwrote eval/agent-results.json\n`);

  return summary.with && summary.with.passed < summary.with.total ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('agent eval failed:', err.message);
    process.exit(1);
  });

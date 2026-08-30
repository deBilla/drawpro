#!/usr/bin/env node
/**
 * The deterministic eval suite.
 *
 *   npm run eval --workspace @drawpro/mcp
 *
 * Runs the published server over a real MCP stdio session against a fake
 * DrawPro API, and grades the artefacts it produces. No account, no API key, no
 * network, no model — so it gates CI on every push, and anyone can reproduce
 * the number in this repository's README by running one command.
 *
 * What it deliberately does not measure: whether a model chooses the right tool
 * or writes a good spec. That needs a model, and lives in `agent/` behind an
 * API key. These two answer different questions and neither substitutes for the
 * other — see eval/README.md.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Grader, tally, type SuiteResult } from './grade';
import { contract } from './suites/contract';
import { generation } from './suites/generation';
import { privacy } from './suites/privacy';
import { recovery } from './suites/recovery';

const SUITES = [contract, generation, privacy, recovery];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

async function main(): Promise<number> {
  const started = Date.now();
  const results: SuiteResult[] = [];

  console.log(`\n${BOLD}DrawPro MCP — deterministic eval${OFF}`);
  console.log(`${DIM}real server, real protocol, fake account${OFF}\n`);

  for (const suite of SUITES) {
    const grader = new Grader();
    let error: string | undefined;
    try {
      await suite.run(grader);
    } catch (err) {
      error = (err as Error).message;
    }

    const passed = grader.checks.filter((c) => c.pass).length;
    const total = grader.checks.length;
    const clean = passed === total && !error;

    console.log(
      `  ${clean ? GREEN + '✓' : RED + '✗'}${OFF} ${BOLD}${suite.name}${OFF} ` +
        `${DIM}${passed}/${total}${OFF}`,
    );
    for (const check of grader.checks) {
      if (check.pass) {
        console.log(`      ${GREEN}pass${OFF}  ${DIM}${check.title}${OFF}`);
      } else {
        console.log(`      ${RED}FAIL${OFF}  ${check.title}${check.critical ? RED + '  [critical]' + OFF : ''}`);
        if (check.detail) console.log(`            ${DIM}${check.detail}${OFF}`);
      }
    }
    if (error) console.log(`      ${RED}ERROR${OFF} ${error}`);
    console.log('');

    results.push({ name: suite.name, description: suite.description, checks: grader.checks, error });
  }

  const { passed, total, criticalFailures } = tally(results);
  const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`${BOLD}score ${passed}/${total} (${pct}%)${OFF} in ${seconds}s`);
  if (criticalFailures.length) {
    console.log(`${RED}${criticalFailures.length} critical failure(s)${OFF}`);
    for (const f of criticalFailures) console.log(`  ${f.id}: ${f.title}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    version: require('../package.json').version as string,
    durationSeconds: Number(seconds),
    passed,
    total,
    percent: pct,
    criticalFailures: criticalFailures.map((c) => c.id),
    suites: results,
  };

  writeFileSync(join(__dirname, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(__dirname, 'SCORECARD.md'), scorecard(report));
  console.log(`${DIM}wrote eval/results.json and eval/SCORECARD.md${OFF}\n`);

  return passed === total ? 0 : 1;
}

function scorecard(report: {
  generatedAt: string;
  version: string;
  passed: number;
  total: number;
  percent: number;
  suites: SuiteResult[];
}): string {
  const lines: string[] = [];
  lines.push('# MCP eval scorecard');
  lines.push('');
  lines.push(
    `\`@drawpro/mcp\` **${report.version}** — **${report.passed}/${report.total}** checks passing ` +
      `(${report.percent}%), generated ${report.generatedAt.slice(0, 10)}.`,
  );
  lines.push('');
  lines.push(
    'Produced by `npm run eval --workspace @drawpro/mcp`, which drives the real server over a real ' +
      'MCP stdio session against a fake DrawPro API. No account, no API key, no network. ' +
      'Every check below states what it protects, because a check that cannot say that is ' +
      'measuring its own implementation.',
  );
  lines.push('');

  for (const suite of report.suites) {
    const passed = suite.checks.filter((c) => c.pass).length;
    lines.push(`## ${suite.name} — ${passed}/${suite.checks.length}`);
    lines.push('');
    lines.push(`${suite.description}`);
    lines.push('');
    lines.push('| | Check | Guards against |');
    lines.push('|---|---|---|');
    for (const c of suite.checks) {
      const mark = c.pass ? '✅' : c.critical ? '🚨' : '❌';
      lines.push(`| ${mark} | ${c.title} | ${c.guards} |`);
    }
    lines.push('');
    if (suite.error) lines.push(`> Suite errored: \`${suite.error}\``, '');
  }

  return lines.join('\n') + '\n';
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('eval harness failed:', err);
    process.exit(1);
  });

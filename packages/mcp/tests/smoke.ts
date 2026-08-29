#!/usr/bin/env node
/**
 * Drives the server over a real stdio MCP session.
 *
 *   DRAWPRO_TOKEN=dp_live_... npx tsx packages/mcp/tests/smoke.ts
 *
 * Compiling proves nothing about protocol behaviour, so this spawns the server
 * as a subprocess and speaks MCP to it. Read-only by design — it never creates
 * or modifies a sheet.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';

let failures = 0;
function check(label: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  — ${detail}`}`);
  if (!pass) failures++;
}

function bodyOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', join(__dirname, '../src/server.ts')],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client({ name: 'smoke', version: '0.0.1' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check('server exposes the six tools', names.length === 6, names.join(', '));
  check(
    'tool names are as documented',
    JSON.stringify(names) ===
      JSON.stringify([
        'create_diagram',
        'list_sheets',
        'list_workspaces',
        'read_sheet',
        'update_diagram',
        'validate_spec',
      ]),
    names.join(', '),
  );

  check(
    'every tool carries a description',
    tools.every((t) => (t.description ?? '').length > 20),
  );

  // validate_spec has no side effects, so both paths are safe to exercise.
  const bad = bodyOf(
    await client.callTool({
      name: 'validate_spec',
      arguments: {
        spec: {
          nodes: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'dup' },
          ],
          edges: [{ from: 'a', to: 'ghost' }],
        },
      },
    }),
  );
  check('validate_spec reports a duplicate id', bad.includes("Duplicate node id 'a'"), bad);
  check('validate_spec reports a dangling edge', bad.includes("unknown node 'ghost'"), bad);

  const good = bodyOf(
    await client.callTool({
      name: 'validate_spec',
      arguments: {
        spec: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] },
      },
    }),
  );
  check('validate_spec accepts a good spec', good.includes('valid'), good);

  const workspaces = bodyOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));
  check('list_workspaces returns rows', workspaces.split('\n').length >= 1, workspaces.slice(0, 80));

  // Locked accounts must explain how to unlock rather than failing opaquely,
  // and must never ask for the passcode through a tool.
  const locked = workspaces.includes('locked') || workspaces.includes('login.ts');
  const unlocked = !locked;
  console.log(`  INFO  account is ${unlocked ? 'unlocked' : 'locked'}`);
  if (locked) {
    check('locked message names the login step', workspaces.includes('login.ts'), workspaces);
    check('locked message never asks for the passcode directly',
      workspaces.includes('never ask them for the passcode'), workspaces);
  }

  await client.close();
}

main()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch((err) => {
    console.error('smoke failed:', err.message);
    process.exit(1);
  });

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptMessage, decryptMessage } from '@drawpro/client';
import { startFakeApi, type FakeApi, type Sheet } from './fake-api';

/**
 * Spawns the real MCP server and speaks the real protocol to it.
 *
 * Two things make a run hermetic. `DRAWPRO_URL` points the server at the fake
 * API rather than production, and `HOME` points at a throwaway directory —
 * which relocates the config file, the usage log, and (on every platform but a
 * keychain hit) the stored private key. The fixture account's address is one
 * nobody can own, so the macOS keychain lookup misses and falls through to that
 * directory: an eval can never read, or write, a developer's real key.
 */

export interface Env {
  api: FakeApi;
  client: Client;
  /** Text content of a tool call, joined. Tools answer in prose, so this is the answer. */
  call: (name: string, args?: Record<string, unknown>) => Promise<string>;
  /** Decrypt a sheet the server wrote, to grade what actually landed. */
  open: (sheetId: string) => Promise<{ name: string; elements: any[]; appState: unknown }>;
  /** Put an encrypted sheet in the account, as the browser would. */
  seed: (name: string, elements: unknown[]) => Promise<Sheet>;
  home: string;
  close: () => Promise<void>;
}

export interface EnvOptions {
  /** false leaves the private key absent, which is the locked-account path. */
  unlocked?: boolean;
}

function keyFileFor(home: string, email: string): string {
  const id = createHash('sha256').update(email).digest('hex').slice(0, 16);
  return join(home, '.drawpro', `key-${id}`);
}

export async function startEnv(options: EnvOptions = {}): Promise<Env> {
  const unlocked = options.unlocked ?? true;
  const api = await startFakeApi();
  const home = mkdtempSync(join(tmpdir(), 'drawpro-eval-'));

  mkdirSync(join(home, '.drawpro'), { recursive: true, mode: 0o700 });
  if (unlocked) {
    writeFileSync(keyFileFor(home, api.email), Buffer.from(api.privateKey).toString('base64'), {
      mode: 0o600,
    });
  }

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', join(__dirname, '../src/server.ts')],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      DRAWPRO_URL: `${api.url}`,
      DRAWPRO_TOKEN: api.token,
    } as Record<string, string>,
    // Server diagnostics go to stderr; keep them out of the eval's own output.
    stderr: 'ignore',
  });

  const client = new Client({ name: 'drawpro-eval', version: '1.0.0' });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content?: { type: string; text?: string }[];
    };
    return (result.content ?? []).map((c) => c.text ?? '').join('\n');
  };

  const open = async (sheetId: string) => {
    const sheet = api.sheets.get(sheetId);
    if (!sheet?.encryptedData) throw new Error(`sheet ${sheetId} has no ciphertext`);
    return JSON.parse(await decryptMessage(sheet.encryptedData, api.privateKey));
  };

  const seed = async (name: string, elements: unknown[]): Promise<Sheet> => {
    const blob = await encryptMessage(
      JSON.stringify({ name, elements, appState: {} }),
      api.publicKey,
    );
    const id = `sh_seed${api.sheets.size}xxxxxxxxxxxxxxxxxxxx`;
    const sheet: Sheet = {
      id,
      workspaceId: api.workspaceId,
      name: '[encrypted]',
      isEncrypted: true,
      encryptedData: blob,
      updatedAt: new Date().toISOString(),
    };
    api.sheets.set(id, sheet);
    return sheet;
  };

  return {
    api,
    client,
    call,
    open,
    seed,
    home,
    close: async () => {
      await client.close().catch(() => {});
      await api.close();
    },
  };
}

/** The id of the sheet a create/update reply linked to. */
export function sheetIdFrom(reply: string): string | null {
  return reply.match(/\/sheet\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

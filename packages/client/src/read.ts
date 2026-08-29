#!/usr/bin/env node
/**
 * Decrypt one sheet and print what is actually on it.
 *
 *   DRAWPRO_TOKEN=dp_live_... npx tsx packages/client/src/read.ts <sheet url>
 *   ... --json scene.json      also write the full Excalidraw scene
 *
 * The passcode is read with echo suppressed and used only in this process. The
 * server is asked for ciphertext and nothing else.
 */
import { writeFileSync } from 'node:fs';
import { describeScene, formatOutline } from '@drawpro/diagram';
import type { ExcalidrawElement } from '@drawpro/diagram';
import { DrawProClient } from './api';
import { decryptPrivateKey } from './crypto';
import { askHidden } from './prompt';

const BASE_URL = process.env.DRAWPRO_URL ?? 'https://drawpro.kithly.app/api';

/** Accepts a full sheet URL, or a bare "<workspaceId> <sheetId>" pair. */
function parseTarget(args: string[]): { workspaceId: string; sheetId: string } {
  const url = args.find((a) => a.includes('/workspace/'));
  if (url) {
    const m = url.match(/\/workspace\/([^/]+)\/sheet\/([^/?#]+)/);
    if (!m) throw new Error(`Could not parse a workspace and sheet id from ${url}`);
    return { workspaceId: m[1], sheetId: m[2] };
  }
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length < 2) throw new Error('Pass a sheet URL, or <workspaceId> <sheetId>.');
  return { workspaceId: positional[0], sheetId: positional[1] };
}

async function main() {
  const token = process.env.DRAWPRO_TOKEN;
  if (!token) throw new Error('Set DRAWPRO_TOKEN to a dp_live_... token.');

  const args = process.argv.slice(2);
  const { workspaceId, sheetId } = parseTarget(args);
  const jsonFlag = args.indexOf('--json');
  const jsonPath = jsonFlag >= 0 ? args[jsonFlag + 1] : null;

  const client = new DrawProClient(BASE_URL, token);
  const user = await client.me();

  if (!user.encryptedPrivateKey || !user.salt) {
    throw new Error('This account has no encryption keys.');
  }

  const passcode = await askHidden('passcode: ');
  process.stdout.write('unlocking (argon2id, 128 MB)... ');
  const t0 = Date.now();
  const privateKey = await decryptPrivateKey(user.encryptedPrivateKey, passcode, user.salt);
  console.log(`${Date.now() - t0} ms\n`);

  const scene = await client.readSheet(workspaceId, sheetId, privateKey);
  console.log(`sheet: ${scene.name}`);
  console.log(`elements: ${scene.elements.length}\n`);
  console.log(formatOutline(describeScene(scene.elements as ExcalidrawElement[])));

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ type: 'excalidraw', version: 2, source: BASE_URL, elements: scene.elements, appState: scene.appState, files: {} }, null, 2));
    console.log(`\nfull scene written to ${jsonPath}`);
  }
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});

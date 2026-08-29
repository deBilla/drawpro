#!/usr/bin/env node
/**
 * Unlock this account for the MCP server.
 *
 *   DRAWPRO_TOKEN=dp_live_... npx tsx packages/client/src/login.ts
 *   DRAWPRO_TOKEN=dp_live_... npx tsx packages/client/src/login.ts --forget
 *
 * Prompts for the passcode, derives the private key, and stores the key — not
 * the passcode — in the OS keychain. The MCP server reads it from there, so the
 * passcode never reaches a tool argument, the model's context, or a transcript.
 */
import { DrawProClient } from './api';
import { decryptPrivateKey } from './crypto';
import { forgetKey, loadKey, storeKey } from './keystore';
import { askHidden } from './prompt';

const BASE_URL = process.env.DRAWPRO_URL ?? 'https://drawpro.kithly.app/api';

async function main() {
  const token = process.env.DRAWPRO_TOKEN;
  if (!token) throw new Error('Set DRAWPRO_TOKEN to a dp_live_... token.');

  const client = new DrawProClient(BASE_URL, token);
  const user = await client.me();

  if (process.argv.includes('--forget')) {
    forgetKey(user.email);
    console.log(`Forgot the stored key for ${user.email}.`);
    return;
  }

  if (!user.encryptedPrivateKey || !user.salt) {
    console.log(`${user.email} has no encryption keys — nothing to unlock.`);
    return;
  }

  if (loadKey(user.email)) {
    console.log(`${user.email} is already unlocked. Use --forget to clear it.`);
    return;
  }

  const passcode = await askHidden('passcode: ');
  process.stdout.write('deriving key (argon2id, 128 MB)... ');
  const t0 = Date.now();
  const key = await decryptPrivateKey(user.encryptedPrivateKey, passcode, user.salt);
  console.log(`${Date.now() - t0} ms`);

  const { location } = storeKey(user.email, key);
  console.log(`Unlocked ${user.email}. Key stored in the ${location}.`);
  console.log('The MCP server can now read your sheets.');
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});

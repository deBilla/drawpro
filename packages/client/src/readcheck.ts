#!/usr/bin/env node
/**
 * Prove the Node crypto port can read what the browser actually wrote.
 *
 *   DRAWPRO_TOKEN=dp_live_... npx tsx packages/client/src/readcheck.ts
 *
 * Prompts for the account passcode, unwraps the private key locally, and lists
 * every sheet with its decrypted name and element count.
 *
 * The passcode is read with echo suppressed, used to derive the key in this
 * process, and never written to disk, logged, or sent anywhere. The server is
 * only ever asked for ciphertext.
 */
import { createInterface } from 'node:readline';
import { DrawProClient } from './api';
import { decryptPrivateKey } from './crypto';

const BASE_URL = process.env.DRAWPRO_URL ?? 'https://drawpro.kithly.app/api';

const CLEAR_LINE = '\x1b[2K\x1b[200D';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin;
    process.stdout.write(question);
    // Redraw the line as asterisks so the passcode never reaches the screen
    // or the terminal's scrollback.
    const onData = () => {
      const typed = (rl as unknown as { line: string }).line ?? '';
      process.stdout.write(CLEAR_LINE + question + '*'.repeat(typed.length));
    };
    stdin.on('data', onData);
    rl.question('', (answer) => {
      stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const token = process.env.DRAWPRO_TOKEN;
  if (!token) throw new Error('Set DRAWPRO_TOKEN to a dp_live_... token.');

  const client = new DrawProClient(BASE_URL, token);
  const user = await client.me();
  console.log(`account: ${user.email}`);

  if (!user.encryptedPrivateKey || !user.salt) {
    console.log('This account has no encryption keys - sheets are stored in plaintext.');
    return;
  }

  const passcode = await askHidden('passcode: ');
  process.stdout.write('deriving key (argon2id, 128 MB)... ');
  const t0 = Date.now();
  const privateKey = await decryptPrivateKey(user.encryptedPrivateKey, passcode, user.salt);
  console.log(`unlocked in ${Date.now() - t0} ms\n`);

  for (const ws of await client.listWorkspaces()) {
    const name = (await client.readName(ws.encryptedName, privateKey)) ?? ws.name;
    console.log(`workspace  ${name}`);

    for (const sheet of await client.listSheets(ws.id)) {
      try {
        const scene = await client.readSheet(ws.id, sheet.id, privateKey);
        console.log(`    ${scene.name.padEnd(34)} ${scene.elements.length} elements`);
      } catch (err) {
        console.log(`    ${sheet.id}  COULD NOT DECRYPT - ${(err as Error).message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});

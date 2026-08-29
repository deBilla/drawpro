import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Where the unwrapped private key lives between commands.
 *
 * The MCP server speaks the protocol over stdio, so it cannot prompt for a
 * passcode — and routing one through a tool argument would put the account's
 * master secret into the model's context and transcript. Instead an interactive
 * `login` derives the key once and stores it here; the server only reads it.
 *
 * On macOS that means the login keychain. Elsewhere it is a 0600 file under
 * ~/.drawpro, which is the same posture as ~/.ssh private keys and
 * ~/.aws/credentials: readable by this user, and by anything running as them.
 * The passcode itself is never stored in either case.
 */

const SERVICE = 'drawpro-mcp';

function accountId(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}

function filePath(email: string): string {
  return join(homedir(), '.drawpro', `key-${accountId(email)}`);
}

function macOS(): boolean {
  return process.platform === 'darwin';
}

export function storeKey(email: string, key: Uint8Array): { location: string } {
  const encoded = Buffer.from(key).toString('base64');

  if (macOS()) {
    try {
      execFileSync(
        'security',
        ['add-generic-password', '-a', accountId(email), '-s', SERVICE, '-w', encoded, '-U'],
        { stdio: 'ignore' },
      );
      return { location: 'macOS keychain' };
    } catch {
      // Fall through to the file store rather than failing the login.
    }
  }

  const path = filePath(email);
  mkdirSync(join(homedir(), '.drawpro'), { recursive: true, mode: 0o700 });
  writeFileSync(path, encoded, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { location: path };
}

export function loadKey(email: string): Uint8Array | null {
  if (macOS()) {
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-a', accountId(email), '-s', SERVICE, '-w'],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
        .toString()
        .trim();
      if (out) return new Uint8Array(Buffer.from(out, 'base64'));
    } catch {
      // Not in the keychain; try the file store.
    }
  }

  const path = filePath(email);
  if (!existsSync(path)) return null;
  return new Uint8Array(Buffer.from(readFileSync(path, 'utf8').trim(), 'base64'));
}

export function forgetKey(email: string): void {
  if (macOS()) {
    try {
      execFileSync(
        'security',
        ['delete-generic-password', '-a', accountId(email), '-s', SERVICE],
        { stdio: 'ignore' },
      );
    } catch {
      // Nothing stored there.
    }
  }
  const path = filePath(email);
  if (existsSync(path)) rmSync(path);
}

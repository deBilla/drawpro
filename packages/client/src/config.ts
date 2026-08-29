import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Local configuration, at ~/.drawpro/config.json.
 *
 * Holds the telemetry choice and an install id. The install id is generated on
 * this machine and is deliberately not derived from the account: it lets
 * repeated reports from one install be recognised as one install, without
 * identifying whose it is.
 */

export interface Config {
  /** Undecided until the user is asked. Absent means never share. */
  telemetry?: 'on' | 'off';
  installId?: string;
  /** ISO timestamp of the last successful report, to keep sends to once a day. */
  lastReportAt?: string;
}

const DIR = join(homedir(), '.drawpro');
const FILE = join(DIR, 'config.json');

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<Config>): Config {
  const next = { ...readConfig(), ...patch };
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next;
}

/** Stable per-install, created on first use. */
export function installId(): string {
  const config = readConfig();
  if (config.installId) return config.installId;
  return writeConfig({ installId: randomUUID() }).installId!;
}

/** Sharing is off unless explicitly turned on. There is no implied consent from
 *  silence, and no prompt that defaults to yes. */
export function telemetryEnabled(): boolean {
  return readConfig().telemetry === 'on';
}

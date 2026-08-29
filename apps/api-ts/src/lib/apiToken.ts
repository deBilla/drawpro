import crypto from 'crypto';
import { prisma } from './prisma';

/**
 * Personal API tokens for non-browser clients — the DrawPro CLI, and Claude
 * Code through it. JWT access tokens live 15 minutes, which is unusable for a
 * command-line tool; these are long-lived and individually revocable instead.
 *
 * Only the SHA-256 of a token is ever stored. The token itself is returned once
 * at creation and cannot be recovered afterwards, so a database leak does not
 * hand over working credentials.
 */

export const TOKEN_PREFIX = 'dp_live_';

/** Enough of the token to recognise it in a list, far too little to guess. */
const PREFIX_DISPLAY_LENGTH = TOKEN_PREFIX.length + 8;

export function isApiToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): { token: string; tokenHash: string; prefix: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    prefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
  };
}

/** How stale lastUsedAt may get before we spend a write refreshing it. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface VerifiedToken {
  id: string;
  userId: string;
}

/**
 * Resolve a presented token to its owner, or null if it is unknown, revoked,
 * or expired. Lookup is a single indexed read on the hash — the raw token is
 * never compared against stored material, so there is no timing side channel.
 */
export async function verifyApiToken(raw: string): Promise<VerifiedToken | null> {
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastUsedAt: true },
  });

  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;

  const stale =
    !record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;
  if (stale) {
    // Fire-and-forget: a bookkeeping write must not add latency to every
    // authenticated request, nor fail one if it errors.
    void prisma.apiToken
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return { id: record.id, userId: record.userId };
}

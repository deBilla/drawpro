import { Router, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { generateToken } from '../lib/apiToken';
import { requireAuth, requireSession, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many token requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  /** Omit for a token that does not expire. */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Enough for a few machines without letting an account accrue forgotten keys. */
const MAX_ACTIVE_TOKENS = 20;

/** Never selects tokenHash — the hash should not leave the database. */
const TOKEN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

// Every route here is session-only: an API token must not be able to mint,
// enumerate, or revoke tokens.
router.use(requireAuth, requireSession);

// POST /auth/tokens
router.post('/', createLimiter, validate(createSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, expiresInDays } = req.body as { name: string; expiresInDays?: number };

    const active = await prisma.apiToken.count({
      where: { userId: req.userId!, revokedAt: null },
    });
    if (active >= MAX_ACTIVE_TOKENS) {
      return res.status(409).json({
        error: `Token limit reached (${MAX_ACTIVE_TOKENS}). Revoke an existing token first.`,
      });
    }

    const { token, tokenHash, prefix } = generateToken();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const created = await prisma.apiToken.create({
      data: { userId: req.userId!, name, prefix, tokenHash, expiresAt },
      select: TOKEN_SELECT,
    });

    // The only time the raw token is ever returned.
    return res.status(201).json({ data: { ...created, token } });
  } catch (err) {
    console.error('[tokens/create]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/tokens
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const tokens = await prisma.apiToken.findMany({
      where: { userId: req.userId!, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: TOKEN_SELECT,
    });
    return res.json({ data: tokens });
  } catch (err) {
    console.error('[tokens/list]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /auth/tokens/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // Revoked rather than deleted, so lastUsedAt survives as an audit trail.
    const result = await prisma.apiToken.updateMany({
      where: { id: req.params.id, userId: req.userId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    return res.json({ data: { message: 'Token revoked' } });
  } catch (err) {
    console.error('[tokens/revoke]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

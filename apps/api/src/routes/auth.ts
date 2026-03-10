import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { validate } from '../middleware/validate';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ENV } from '../config/env';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, ENV.JWT_ACCESS_SECRET, {
    expiresIn: ENV.JWT_ACCESS_TTL,
  } as jwt.SignOptions);
}

async function generateRefreshToken(userId: string): Promise<string> {
  const tokenId = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti: tokenId },
    ENV.JWT_REFRESH_SECRET,
    { expiresIn: ENV.JWT_REFRESH_TTL } as jwt.SignOptions,
  );
  await redis.setex(`rt:${userId}:${tokenId}`, ENV.JWT_REFRESH_TTL, '1');
  return token;
}

async function invalidateRefreshToken(userId: string, tokenId: string): Promise<void> {
  await redis.del(`rt:${userId}:${tokenId}`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /auth/register
router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    return res.status(201).json({ data: { accessToken, refreshToken, user } });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    const { passwordHash: _ph, ...safeUser } = user;
    return res.json({ data: { accessToken, refreshToken, user: safeUser } });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/refresh
router.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const { refreshToken } = req.body;

    let payload: { sub: string; jti: string };
    try {
      payload = jwt.verify(refreshToken, ENV.JWT_REFRESH_SECRET) as {
        sub: string;
        jti: string;
      };
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const exists = await redis.get(`rt:${payload.sub}:${payload.jti}`);
    if (!exists) {
      return res.status(401).json({ error: 'Refresh token revoked' });
    }

    // Rotate: invalidate old → issue new
    await invalidateRefreshToken(payload.sub, payload.jti);
    const newAccessToken = generateAccessToken(payload.sub);
    const newRefreshToken = await generateRefreshToken(payload.sub);

    return res.json({ data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    console.error('[auth/refresh]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      try {
        const payload = jwt.verify(refreshToken, ENV.JWT_REFRESH_SECRET) as {
          sub: string;
          jti: string;
        };
        await invalidateRefreshToken(payload.sub, payload.jti);
      } catch {
        // already expired — fine
      }
    }
    return res.json({ data: { message: 'Logged out' } });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ data: user });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

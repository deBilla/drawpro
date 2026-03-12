import { Router, Request, Response, CookieOptions } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { validate } from '../middleware/validate';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ENV } from '../config/env';

const router = Router();

// ─── Rate limiting ────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const keysSchema = z.object({
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  salt: z.string().min(1),
  recoveryCodesData: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  publicKey: true,
  encryptedPrivateKey: true,
  salt: true,
  recoveryCodesData: true,
  createdAt: true,
} as const;

/** Parse a JWT TTL string like '15m', '1h', '7d' into seconds. */
function parseTTLSeconds(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return parseInt(ttl, 10);
  const n = parseInt(match[1], 10);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (units[match[2]] ?? 1);
}

const isSecure = ENV.FRONTEND_URL.startsWith('https');

function accessCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: parseTTLSeconds(ENV.JWT_ACCESS_TTL) * 1000,
  };
}

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: ENV.JWT_REFRESH_TTL * 1000,
  };
}

function clearCookies(res: Response): void {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });
}

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

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('accessToken', accessToken, accessCookieOptions());
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /auth/register
router.post('/register', authLimiter, validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name?: string };

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
      select: USER_SELECT,
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    setAuthCookies(res, accessToken, refreshToken);

    return res.status(201).json({ data: { user } });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.user.findUnique({
      where: { email },
      select: { ...USER_SELECT, passwordHash: true },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash: _ph, ...safeUser } = user;
    return res.json({ data: { user: safeUser } });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/refresh
router.post('/refresh', authLimiter, async (req: Request, res: Response) => {
  try {
    const refreshToken =
      (req.cookies as Record<string, string>)?.refreshToken ??
      (req.body as Record<string, string>)?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Missing refresh token' });
    }

    let payload: { sub: string; jti: string };
    try {
      payload = jwt.verify(refreshToken, ENV.JWT_REFRESH_SECRET) as { sub: string; jti: string };
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
    setAuthCookies(res, newAccessToken, newRefreshToken);

    return res.json({ data: { message: 'ok' } });
  } catch (err) {
    console.error('[auth/refresh]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const refreshToken = (req.cookies as Record<string, string>)?.refreshToken;
    if (refreshToken) {
      try {
        const payload = jwt.verify(refreshToken, ENV.JWT_REFRESH_SECRET) as { sub: string; jti: string };
        await invalidateRefreshToken(payload.sub, payload.jti);
      } catch {
        // already expired — fine
      }
    }
    clearCookies(res);
    return res.json({ data: { message: 'Logged out' } });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: USER_SELECT,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ data: user });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /auth/keys — upload X25519 public key + argon2id-wrapped private key + recovery codes
// The server never sees the passcode; this just persists the encrypted blobs.
router.put('/keys', requireAuth, validate(keysSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { publicKey, encryptedPrivateKey, salt, recoveryCodesData } = req.body as {
      publicKey: string;
      encryptedPrivateKey: string;
      salt: string;
      recoveryCodesData: string;
    };

    // Validate recoveryCodesData is valid JSON array
    try {
      const codes = JSON.parse(recoveryCodesData) as unknown[];
      if (!Array.isArray(codes) || codes.length === 0) {
        return res.status(400).json({ error: 'recoveryCodesData must be a non-empty JSON array' });
      }
    } catch {
      return res.status(400).json({ error: 'recoveryCodesData must be valid JSON' });
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { publicKey, encryptedPrivateKey, salt, recoveryCodesData },
      select: USER_SELECT,
    });

    return res.json({ data: user });
  } catch (err) {
    console.error('[auth/keys]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

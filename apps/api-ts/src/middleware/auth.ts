import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import { isApiToken, verifyApiToken } from '../lib/apiToken';

/** How the caller proved who they are. Some routes care about the difference. */
export type AuthMethod = 'session' | 'api-token';

export interface AuthRequest extends Request {
  userId?: string;
  authMethod?: AuthMethod;
  apiTokenId?: string;
}

function bearerFrom(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const cookieToken = (req.cookies as Record<string, string>)?.accessToken;
  const headerToken = bearerFrom(req);

  // A personal API token is only ever presented as a bearer header.
  if (headerToken && isApiToken(headerToken)) {
    verifyApiToken(headerToken)
      .then((verified) => {
        if (!verified) {
          res.status(401).json({ error: 'Invalid, revoked, or expired API token' });
          return;
        }
        req.userId = verified.userId;
        req.authMethod = 'api-token';
        req.apiTokenId = verified.id;
        next();
      })
      .catch((err) => {
        console.error('[auth/api-token]', err);
        res.status(500).json({ error: 'Internal server error' });
      });
    return;
  }

  const token = cookieToken ?? headerToken;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  try {
    const payload = jwt.verify(token, ENV.JWT_ACCESS_SECRET) as { sub: string };
    req.userId = payload.sub;
    req.authMethod = 'session';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/**
 * Reject anything authenticated with an API token.
 *
 * Guards credential management: a leaked token must not be able to mint more
 * tokens, enumerate the others, or revoke them to lock the owner out. Those
 * actions require a real logged-in session.
 */
export function requireSession(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.authMethod !== 'session') {
    res.status(403).json({
      error: 'This action requires a logged-in session. API tokens cannot manage API tokens.',
    });
    return;
  }
  next();
}

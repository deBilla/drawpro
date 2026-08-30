import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ENV, GOOGLE_AUTH_ENABLED } from '../config/env';

/**
 * Firebase is used for exactly one thing: proving that a browser really did
 * sign in with Google. Once the ID token checks out, DrawPro issues its own
 * session cookies and Firebase is out of the picture — refresh rotation, API
 * tokens and the E2EE passcode all work as they do for password accounts.
 */

let app: App | undefined;

function getApp(): App {
  if (app) return app;

  // Reuse the app across tsx-watch reloads instead of throwing on re-init.
  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  app = initializeApp({
    credential: cert({
      projectId: ENV.FIREBASE_PROJECT_ID,
      clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
      // Secret managers and .env files carry the PEM with escaped newlines.
      privateKey: ENV.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
    projectId: ENV.FIREBASE_PROJECT_ID,
  });
  return app;
}

/** The subset of a verified Google identity that DrawPro stores. */
export interface GoogleIdentity {
  /** Firebase UID — stable per user, the value we persist as `googleId`. */
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/**
 * Verify a Firebase ID token minted by the browser SDK.
 *
 * Returns null for anything untrustworthy — a bad signature, an expired or
 * revoked token, a token for another Firebase project, or one that carries no
 * email. Callers must not distinguish these to the client.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  if (!GOOGLE_AUTH_ENABLED) return null;

  try {
    // checkRevoked: a token whose session was revoked in Firebase is rejected.
    const decoded = await getAuth(getApp()).verifyIdToken(idToken, true);
    if (!decoded.email) return null;

    return {
      uid: decoded.uid,
      email: decoded.email.toLowerCase(),
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      picture: typeof decoded.picture === 'string' ? decoded.picture : undefined,
    };
  } catch (err) {
    console.warn('[firebase] ID token rejected:', (err as Error).message);
    return null;
  }
}

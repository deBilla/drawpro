import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';

/**
 * Firebase is only an identity check here. We take the ID token it produces,
 * hand it to POST /auth/google, and let the API mint the httpOnly session
 * cookies the rest of the app already uses. No Firebase state is kept around
 * after that, so there is no second source of truth for "am I logged in".
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** False when the build has no Firebase config — callers hide the button. */
export const isGoogleAuthConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

function getFirebaseAuth(): Auth {
  if (!isGoogleAuthConfigured) {
    throw new Error('Firebase is not configured for this build');
  }
  if (!auth) {
    app = initializeApp({
      apiKey: config.apiKey!,
      authDomain: config.authDomain!,
      projectId: config.projectId!,
      appId: config.appId!,
    });
    auth = getAuth(app);
  }
  return auth;
}

/** Raised when the user closes the Google popup — not an error worth showing. */
export class GoogleSignInCancelled extends Error {}

const CANCEL_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

/**
 * Open the Google popup and return a fresh Firebase ID token.
 * Throws GoogleSignInCancelled if the user dismissed the popup.
 */
export async function signInWithGoogle(): Promise<string> {
  const firebaseAuth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  // Always show the chooser: users with several Google accounts otherwise get
  // silently signed in as whichever one the browser saw last.
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const credential = await signInWithPopup(firebaseAuth, provider);
    const idToken = await credential.user.getIdToken();

    // The DrawPro session cookie is the real credential from here on; drop the
    // Firebase session so it cannot drift out of sync with ours.
    await signOut(firebaseAuth).catch(() => {});

    return idToken;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && CANCEL_CODES.has(code)) {
      throw new GoogleSignInCancelled('Sign-in cancelled');
    }
    throw err;
  }
}

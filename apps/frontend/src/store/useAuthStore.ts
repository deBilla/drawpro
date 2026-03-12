import { create } from 'zustand';
import type { User } from '@drawpro/shared-types';
import { exportPrivateKeyToSession, importPrivateKeyFromSession } from '../lib/crypto';

const SESSION_KEY = 'cachedPrivateKey';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;

  /**
   * The user's raw 32-byte X25519 private key.
   * Persisted in sessionStorage (base64) so page refreshes within the same tab
   * don't require re-entering the passcode.
   * Cleared on logout.
   */
  cachedPrivateKey: Uint8Array | null;

  /**
   * True while the session-stored key is being restored from sessionStorage on
   * page reload. Prevents the GlobalUnlockModal from flashing before restore completes.
   */
  keyRestoring: boolean;

  /** Called after a successful login/register — tokens are set as httpOnly cookies. */
  login: (user: User) => void;
  logout: () => void;
  updateUser: (user: User) => void;
  setCachedPrivateKey: (key: Uint8Array) => void;
}

// Sync hydration from localStorage (user profile only — tokens live in httpOnly cookies)
const storedUserRaw = localStorage.getItem('user');
const storedUser: User | null = storedUserRaw ? (JSON.parse(storedUserRaw) as User) : null;

const sessionB64 = sessionStorage.getItem(SESSION_KEY);
const willRestoreKey = !!(sessionB64 && storedUser);

export const useAuthStore = create<AuthState>()((set) => ({
  user: storedUser,
  isAuthenticated: !!storedUser,
  cachedPrivateKey: null,
  keyRestoring: willRestoreKey,

  login(user) {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.setItem('user', JSON.stringify(user));
    set({
      user,
      isAuthenticated: true,
      cachedPrivateKey: null,
      keyRestoring: false,
    });
  },

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('user');
    set({ user: null, isAuthenticated: false, cachedPrivateKey: null, keyRestoring: false });
  },

  updateUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
    set({ user });
  },

  setCachedPrivateKey(key) {
    // Persist raw bytes as base64 in sessionStorage (survives refresh, cleared on tab close)
    sessionStorage.setItem(SESSION_KEY, exportPrivateKeyToSession(key));
    set({ cachedPrivateKey: key, keyRestoring: false });
  },
}));

// ─── Async session restore ────────────────────────────────────────────────────
// importPrivateKeyFromSession is synchronous (just base64 decode), but keep async
// pattern in case we add validation later.

if (willRestoreKey) {
  try {
    const key = importPrivateKeyFromSession(sessionB64!);
    useAuthStore.setState({ cachedPrivateKey: key, keyRestoring: false });
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    useAuthStore.setState({ keyRestoring: false });
  }
}

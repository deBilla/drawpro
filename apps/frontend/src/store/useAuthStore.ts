import { create } from 'zustand';
import type { User, AuthTokens } from '@drawpro/shared-types';
import { exportPrivateKeyToSession, importPrivateKeyFromSession } from '../lib/crypto';

const SESSION_KEY = 'cachedPrivateKey';

interface AuthState {
  user: User | null;
  accessToken: string | null;
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

  login: (tokens: AuthTokens) => void;
  logout: () => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  updateUser: (user: User) => void;
  setCachedPrivateKey: (key: Uint8Array) => void;
}

// Sync hydration from localStorage
const storedAccess = localStorage.getItem('accessToken');
const storedUserRaw = localStorage.getItem('user');
const storedUser: User | null = storedUserRaw ? (JSON.parse(storedUserRaw) as User) : null;

const sessionB64 = sessionStorage.getItem(SESSION_KEY);
const willRestoreKey = !!(sessionB64 && storedUser);

export const useAuthStore = create<AuthState>()((set) => ({
  user: storedUser,
  accessToken: storedAccess,
  isAuthenticated: !!storedAccess && !!storedUser,
  cachedPrivateKey: null,
  keyRestoring: willRestoreKey,

  login(tokens) {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    localStorage.setItem('user', JSON.stringify(tokens.user));
    set({
      user: tokens.user,
      accessToken: tokens.accessToken,
      isAuthenticated: true,
      cachedPrivateKey: null,
      keyRestoring: false,
    });
  },

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    set({ user: null, accessToken: null, isAuthenticated: false, cachedPrivateKey: null, keyRestoring: false });
  },

  setTokens({ accessToken, refreshToken }) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ accessToken });
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

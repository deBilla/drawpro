import { create } from 'zustand';
import type { User, AuthTokens } from '@drawpro/shared-types';
import { exportPrivateKeyToSession, importPrivateKeyFromSession } from '../lib/crypto';

const SESSION_KEY = 'cachedPrivateKey';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;

  /**
   * The user's X25519 private key, decrypted from `user.encryptedPrivateKey`.
   * Persisted in sessionStorage across page reloads (same tab).
   * Cleared on logout or when the user closes the tab.
   */
  cachedPrivateKey: CryptoKey | null;

  /**
   * True while the session-stored private key is being asynchronously re-imported
   * on page reload. Prevents a false "unlock required" flash during restore.
   */
  keyRestoring: boolean;

  login: (tokens: AuthTokens) => void;
  logout: () => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  /** Called after a successful PUT /auth/keys to update the user record in state. */
  updateUser: (user: User) => void;
  /** Cache the decrypted X25519 private key; persists to sessionStorage for this tab. */
  setCachedPrivateKey: (key: CryptoKey) => void;
}

// Hydrate sync state from localStorage
const storedAccess = localStorage.getItem('accessToken');
const storedUserRaw = localStorage.getItem('user');
const storedUser: User | null = storedUserRaw ? (JSON.parse(storedUserRaw) as User) : null;

// Detect if we'll be restoring a key so we can set keyRestoring: true from the start
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
    exportPrivateKeyToSession(key).then((b64) => {
      sessionStorage.setItem(SESSION_KEY, b64);
    });
    set({ cachedPrivateKey: key, keyRestoring: false });
  },
}));

// ─── Async session restore ────────────────────────────────────────────────────

if (willRestoreKey) {
  importPrivateKeyFromSession(sessionB64!)
    .then((key) => {
      useAuthStore.setState({ cachedPrivateKey: key, keyRestoring: false });
    })
    .catch(() => {
      sessionStorage.removeItem(SESSION_KEY);
      useAuthStore.setState({ keyRestoring: false });
    });
}

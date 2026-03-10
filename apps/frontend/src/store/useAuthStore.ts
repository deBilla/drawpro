import { create } from 'zustand';
import type { User, AuthTokens } from '@drawpro/shared-types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;

  login: (tokens: AuthTokens) => void;
  logout: () => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
}

// Hydrate from localStorage on store creation
const storedAccess = localStorage.getItem('accessToken');
const storedUserRaw = localStorage.getItem('user');
const storedUser: User | null = storedUserRaw ? JSON.parse(storedUserRaw) : null;

export const useAuthStore = create<AuthState>()((set) => ({
  user: storedUser,
  accessToken: storedAccess,
  isAuthenticated: !!storedAccess && !!storedUser,

  login(tokens) {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    localStorage.setItem('user', JSON.stringify(tokens.user));
    set({ user: tokens.user, accessToken: tokens.accessToken, isAuthenticated: true });
  },

  logout() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  setTokens({ accessToken, refreshToken }) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ accessToken });
  },
}));

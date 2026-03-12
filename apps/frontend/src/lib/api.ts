import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  AuthTokens,
  Workspace,
  Sheet,
  SheetSummary,
  CreateWorkspaceInput,
  CreateSheetInput,
  UpdateSheetInput,
  SetUserKeysInput,
  User,
  ApiResponse,
} from '@drawpro/shared-types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  // Send httpOnly auth cookies with every request
  withCredentials: true,
});

// ─── Token refresh on 401 ────────────────────────────────────────────────────

let isRefreshing = false;
let pendingRequests: Array<() => void> = [];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    // Skip refresh for auth routes to avoid infinite loops
    if (original.url?.startsWith('/auth')) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (isRefreshing) {
      return new Promise((resolve) => {
        pendingRequests.push(() => resolve(apiClient(original)));
      });
    }

    isRefreshing = true;
    try {
      // Refresh token is in the httpOnly cookie — no body needed
      await apiClient.post('/auth/refresh');

      pendingRequests.forEach((cb) => cb());
      pendingRequests = [];

      return apiClient(original);
    } catch {
      pendingRequests = [];
      // Clear stored user so RequireGuest doesn't redirect back to '/' on reload
      localStorage.removeItem('user');
      sessionStorage.removeItem('cachedPrivateKey');
      window.location.href = '/login';
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (body: { email: string; password: string; name?: string }) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/register', body).then((r) => r.data.data),

  login: (body: { email: string; password: string }) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/login', body).then((r) => r.data.data),

  logout: () =>
    apiClient.post('/auth/logout'),

  me: () =>
    apiClient.get<ApiResponse<User>>('/auth/me').then((r) => r.data.data),
};

// ─── Keys — client-controlled encryption at rest ──────────────────────────────

export const keysApi = {
  /** Upload the user's X25519 public key + argon2id-wrapped private key. Returns updated User. */
  setKeys: (body: SetUserKeysInput) =>
    apiClient.put<ApiResponse<User>>('/auth/keys', body).then((r) => r.data.data),
};

// ─── Workspaces ──────────────────────────────────────────────────────────────

export const workspacesApi = {
  list: () =>
    apiClient.get<ApiResponse<Workspace[]>>('/workspaces').then((r) => r.data.data),

  create: (body: CreateWorkspaceInput) =>
    apiClient.post<ApiResponse<Workspace>>('/workspaces', body).then((r) => r.data.data),

  get: (id: string) =>
    apiClient
      .get<ApiResponse<Workspace & { sheets: SheetSummary[] }>>(`/workspaces/${id}`)
      .then((r) => r.data.data),

  delete: (id: string) =>
    apiClient.delete(`/workspaces/${id}`),
};

// ─── Sheets ──────────────────────────────────────────────────────────────────

export const sheetsApi = {
  list: (workspaceId: string) =>
    apiClient
      .get<ApiResponse<SheetSummary[]>>(`/workspaces/${workspaceId}/sheets`)
      .then((r) => r.data.data),

  create: (workspaceId: string, body: CreateSheetInput) =>
    apiClient
      .post<ApiResponse<Sheet>>(`/workspaces/${workspaceId}/sheets`, body)
      .then((r) => r.data.data),

  get: (workspaceId: string, id: string) =>
    apiClient
      .get<ApiResponse<Sheet>>(`/workspaces/${workspaceId}/sheets/${id}`)
      .then((r) => r.data.data),

  update: (workspaceId: string, id: string, body: UpdateSheetInput) =>
    apiClient
      .put<ApiResponse<Sheet>>(`/workspaces/${workspaceId}/sheets/${id}`, body)
      .then((r) => r.data.data),

  delete: (workspaceId: string, id: string) =>
    apiClient.delete(`/workspaces/${workspaceId}/sheets/${id}`),
};

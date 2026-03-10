import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  AuthTokens,
  RefreshResponse,
  Workspace,
  Sheet,
  SheetSummary,
  CreateWorkspaceInput,
  CreateSheetInput,
  UpdateSheetInput,
  ApiResponse,
} from '@drawpro/shared-types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Auth token injection ────────────────────────────────────────────────────

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Token refresh on 401 ────────────────────────────────────────────────────

let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

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
      return new Promise((resolve, reject) => {
        pendingRequests.push((newToken) => {
          if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
          resolve(apiClient(original));
        });
      });
    }

    isRefreshing = true;
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw new Error('No refresh token');

      const { data } = await apiClient.post<ApiResponse<RefreshResponse>>('/auth/refresh', {
        refreshToken,
      });

      const { accessToken: newAccess, refreshToken: newRefresh } = data.data;
      localStorage.setItem('accessToken', newAccess);
      localStorage.setItem('refreshToken', newRefresh);

      pendingRequests.forEach((cb) => cb(newAccess));
      pendingRequests = [];

      if (original.headers) original.headers.Authorization = `Bearer ${newAccess}`;
      return apiClient(original);
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
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

  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refreshToken }),

  me: () =>
    apiClient.get<ApiResponse<AuthTokens['user']>>('/auth/me').then((r) => r.data.data),
};

// ─── Workspaces ──────────────────────────────────────────────────────────────

export const workspacesApi = {
  list: () =>
    apiClient.get<ApiResponse<Workspace[]>>('/workspaces').then((r) => r.data.data),

  create: (body: CreateWorkspaceInput) =>
    apiClient.post<ApiResponse<Workspace>>('/workspaces', body).then((r) => r.data.data),

  get: (id: string) =>
    apiClient.get<ApiResponse<Workspace & { sheets: SheetSummary[] }>>(`/workspaces/${id}`).then((r) => r.data.data),

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

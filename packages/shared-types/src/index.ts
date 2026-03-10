// ─── Domain types ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role?: MemberRole;
  sheetsCount?: number;
}

export interface Sheet {
  id: string;
  workspaceId: string;
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SheetSummary {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type MemberRole = 'owner' | 'editor' | 'viewer';

// ─── Auth types ──────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

// ─── API response envelope ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// ─── Request / DTO types ─────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateWorkspaceInput {
  name: string;
}

export interface CreateSheetInput {
  name: string;
}

export interface UpdateSheetInput {
  name?: string;
  elements?: unknown[];
  appState?: Record<string, unknown>;
}

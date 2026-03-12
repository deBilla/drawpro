// ─── Domain types ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name?: string | null;
  /** base64 SPKI DER of the user's X25519 public key. Null if encryption not set up. */
  publicKey?: string | null;
  /** JSON blob: {ciphertext, iv, salt} — passcode-wrapped X25519 private key. Null if encryption not set up. */
  encryptedPrivateKey?: string | null;
  /** JSON blob: {ciphertext, iv} — recovery-key-wrapped X25519 private key. Null if encryption not set up. */
  recoveryEncryptedPrivateKey?: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  /** '[encrypted]' when name is encrypted at rest; real name otherwise. */
  name: string;
  /** JSON blob: {ciphertext,iv,authTag,ephemeralPublicKey} — client-encrypted name. */
  encryptedName?: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role?: MemberRole;
  sheetsCount?: number;
}

export interface Sheet {
  id: string;
  workspaceId: string;
  /** '[encrypted]' when name + content are encrypted at rest; real name otherwise. */
  name: string;
  isEncrypted?: boolean;
  // Plaintext fields — populated when user has no encryption keys
  elements: unknown[] | null;
  appState: Record<string, unknown> | null;
  // Encrypted fields — populated when sheet is encrypted (name included inside ciphertext)
  ciphertext?: string | null;
  iv?: string | null;
  authTag?: string | null;
  ephemeralPublicKey?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SheetSummary {
  id: string;
  workspaceId: string;
  /** '[encrypted]' when encrypted at rest; real name when plaintext. */
  name: string;
  /** True when name + content are encrypted — use as display hint in list views. */
  isEncrypted: boolean;
  // Encrypted fields — present so the client can decrypt the name in list views
  ciphertext?: string | null;
  iv?: string | null;
  authTag?: string | null;
  ephemeralPublicKey?: string | null;
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
  /** Pre-encrypted name (client-side ECIES). If provided, server stores '[encrypted]' sentinel. */
  encryptedName?: string;
}

export interface CreateSheetInput {
  name: string;
}

export interface UpdateSheetInput {
  name?: string;
  elements?: unknown[];
  appState?: Record<string, unknown>;
}

export interface SetUserKeysInput {
  /** base64 SPKI DER of the user's X25519 public key */
  publicKey: string;
  /** JSON: {ciphertext, iv, salt} — passcode-wrapped private key */
  encryptedPrivateKey: string;
  /** JSON: {ciphertext, iv} — recovery-key-wrapped private key */
  recoveryEncryptedPrivateKey: string;
}

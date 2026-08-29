import { decryptMessage, decryptSheet, encryptMessage, type SheetPayload } from './crypto';

/**
 * Thin API client for non-browser callers, authenticating with a personal API
 * token. Content is sealed and opened here, on this machine — the server only
 * ever receives and returns ciphertext.
 */

export interface DrawProUser {
  id: string;
  email: string;
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  salt: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  encryptedName: string | null;
  role?: string;
  sheetsCount?: number;
}

export interface SheetSummary {
  id: string;
  workspaceId: string;
  name: string;
  isEncrypted: boolean;
  encryptedData: string | null;
  updatedAt: string;
}

export class DrawProClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!res.ok) {
      throw new Error(`${path} -> ${res.status} ${body.error ?? JSON.stringify(body)}`);
    }
    return body.data as T;
  }

  me(): Promise<DrawProUser> {
    return this.request<DrawProUser>('/auth/me');
  }

  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.request<WorkspaceSummary[]>('/workspaces');
  }

  listSheets(workspaceId: string): Promise<SheetSummary[]> {
    return this.request<SheetSummary[]>(`/workspaces/${workspaceId}/sheets`);
  }

  getSheet(workspaceId: string, sheetId: string): Promise<SheetSummary> {
    return this.request<SheetSummary>(`/workspaces/${workspaceId}/sheets/${sheetId}`);
  }

  /**
   * Read a sheet's real contents. Requires the private key, so the caller must
   * have unlocked it with the passcode first.
   */
  async readSheet(
    workspaceId: string,
    sheetId: string,
    privateKey: Uint8Array,
  ): Promise<SheetPayload> {
    const sheet = await this.getSheet(workspaceId, sheetId);
    if (!sheet.encryptedData) {
      // Plaintext account (no keys set up) — the fields are already readable.
      const raw = sheet as unknown as SheetPayload;
      return { name: sheet.name, elements: raw.elements ?? [], appState: raw.appState ?? {} };
    }
    return decryptSheet(sheet.encryptedData, privateKey);
  }

  /** Decrypt a workspace or sheet name for display. Returns null if unreadable. */
  async readName(encrypted: string | null, privateKey: Uint8Array): Promise<string | null> {
    if (!encrypted) return null;
    try {
      const opened = await decryptMessage(encrypted, privateKey);
      // Sheet blobs hold a JSON payload; workspace names hold a bare string.
      try {
        return (JSON.parse(opened) as SheetPayload).name;
      } catch {
        return opened;
      }
    } catch {
      return null;
    }
  }

  /**
   * Create a sheet. POST requires a name field, which the server replaces with
   * the '[encrypted]' sentinel; the real name travels inside the blob.
   */
  async createSheet(
    workspaceId: string,
    payload: SheetPayload,
    publicKey: string | null,
  ): Promise<SheetSummary> {
    const body = publicKey
      ? { name: '[encrypted]', encryptedData: await encryptMessage(JSON.stringify(payload), publicKey) }
      : { name: payload.name };
    return this.request<SheetSummary>(`/workspaces/${workspaceId}/sheets`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Replace a sheet's contents. Unlike POST, PUT rejects a plaintext name
   * outright for an encrypted account — the blob is the whole update.
   */
  async updateSheet(
    workspaceId: string,
    sheetId: string,
    payload: SheetPayload,
    publicKey: string | null,
  ): Promise<SheetSummary> {
    const body = publicKey
      ? { encryptedData: await encryptMessage(JSON.stringify(payload), publicKey) }
      : { name: payload.name, elements: payload.elements, appState: payload.appState };
    return this.request<SheetSummary>(`/workspaces/${workspaceId}/sheets/${sheetId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }
}

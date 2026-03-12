import { create } from 'zustand';
import type { Workspace, SheetSummary } from '@drawpro/shared-types';
import { workspacesApi, sheetsApi } from '../lib/api';
import { encryptMessage, decryptMessage, decryptSheet } from '../lib/crypto';
import { useAuthStore } from './useAuthStore';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: (Workspace & { sheets: SheetSummary[] }) | null;
  /** Decrypted workspace names keyed by workspace id. */
  decryptedNames: Record<string, string>;
  /** Decrypted sheet names keyed by sheet id. */
  decryptedSheetNames: Record<string, string>;
  loading: boolean;
  error: string | null;

  fetchWorkspaces: () => Promise<void>;
  fetchWorkspace: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  createSheet: (workspaceId: string, name: string) => Promise<SheetSummary>;
  deleteSheet: (workspaceId: string, sheetId: string) => Promise<void>;
  /** Decrypt all workspace names using the cached private key. */
  decryptWorkspaceNames: (privateKey: Uint8Array) => Promise<void>;
  /** Decrypt all sheet names in the active workspace. */
  decryptSheetNames: (privateKey: Uint8Array) => Promise<void>;
}

async function tryDecryptWorkspaceName(
  encryptedName: string | null | undefined,
  privateKey: Uint8Array,
): Promise<string | null> {
  if (!encryptedName) return null;
  try {
    return await decryptMessage(encryptedName, privateKey);
  } catch {
    return null;
  }
}

async function tryDecryptSheetName(
  sheet: SheetSummary,
  privateKey: Uint8Array,
): Promise<string | null> {
  if (!sheet.encryptedData) return null;
  try {
    const payload = await decryptSheet(sheet.encryptedData, privateKey);
    return payload.name;
  } catch {
    return null;
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  decryptedNames: {},
  decryptedSheetNames: {},
  loading: false,
  error: null,

  async fetchWorkspaces() {
    set({ loading: true, error: null });
    try {
      const workspaces = await workspacesApi.list();
      set({ workspaces, loading: false });

      const { cachedPrivateKey } = useAuthStore.getState();
      if (cachedPrivateKey) {
        get().decryptWorkspaceNames(cachedPrivateKey);
      }
    } catch (err: unknown) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  async fetchWorkspace(id) {
    set({ loading: true, error: null });
    try {
      const ws = await workspacesApi.get(id);
      set({ activeWorkspace: ws, loading: false });

      const { cachedPrivateKey } = useAuthStore.getState();
      if (cachedPrivateKey) {
        // Decrypt workspace name
        if (ws.encryptedName) {
          const decrypted = await tryDecryptWorkspaceName(ws.encryptedName, cachedPrivateKey);
          if (decrypted) {
            set((s) => ({ decryptedNames: { ...s.decryptedNames, [ws.id]: decrypted } }));
          }
        }
        // Decrypt all sheet names in this workspace
        get().decryptSheetNames(cachedPrivateKey);
      }
    } catch (err: unknown) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  async createWorkspace(name) {
    const { user } = useAuthStore.getState();
    let body: Parameters<typeof workspacesApi.create>[0] = { name };

    if (user?.publicKey) {
      const encryptedName = await encryptMessage(name, user.publicKey);
      body = { name: '[encrypted]', encryptedName };
    }

    const ws = await workspacesApi.create(body);
    set((s) => ({
      workspaces: [ws, ...s.workspaces],
      decryptedNames: user?.publicKey
        ? { ...s.decryptedNames, [ws.id]: name }
        : s.decryptedNames,
    }));
    return ws;
  },

  async deleteWorkspace(id) {
    await workspacesApi.delete(id);
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      activeWorkspace: s.activeWorkspace?.id === id ? null : s.activeWorkspace,
      decryptedNames: Object.fromEntries(
        Object.entries(s.decryptedNames).filter(([k]) => k !== id),
      ),
    }));
  },

  async createSheet(workspaceId, name) {
    const sheet = await sheetsApi.create(workspaceId, { name });
    const summary: SheetSummary = {
      id: sheet.id,
      workspaceId: sheet.workspaceId,
      name: sheet.name,
      isEncrypted: sheet.isEncrypted ?? false,
      encryptedData: sheet.encryptedData,
      version: sheet.version,
      createdAt: sheet.createdAt,
      updatedAt: sheet.updatedAt,
    };
    set((s) => ({
      activeWorkspace: s.activeWorkspace
        ? { ...s.activeWorkspace, sheets: [summary, ...s.activeWorkspace.sheets] }
        : null,
    }));
    return summary;
  },

  async deleteSheet(workspaceId, sheetId) {
    await sheetsApi.delete(workspaceId, sheetId);
    set((s) => ({
      activeWorkspace: s.activeWorkspace
        ? {
            ...s.activeWorkspace,
            sheets: s.activeWorkspace.sheets.filter((sh) => sh.id !== sheetId),
          }
        : null,
    }));
  },

  async decryptWorkspaceNames(privateKey) {
    const { workspaces } = get();
    const updates: Record<string, string> = {};
    await Promise.all(
      workspaces.map(async (ws) => {
        if (ws.encryptedName) {
          const decrypted = await tryDecryptWorkspaceName(ws.encryptedName, privateKey);
          if (decrypted) updates[ws.id] = decrypted;
        }
      }),
    );
    if (Object.keys(updates).length > 0) {
      set((s) => ({ decryptedNames: { ...s.decryptedNames, ...updates } }));
    }
  },

  async decryptSheetNames(privateKey) {
    const { activeWorkspace } = get();
    if (!activeWorkspace) return;

    const updates: Record<string, string> = {};
    await Promise.all(
      activeWorkspace.sheets.map(async (sheet) => {
        if (sheet.isEncrypted) {
          const name = await tryDecryptSheetName(sheet, privateKey);
          if (name) updates[sheet.id] = name;
        }
      }),
    );
    if (Object.keys(updates).length > 0) {
      set((s) => ({ decryptedSheetNames: { ...s.decryptedSheetNames, ...updates } }));
    }
  },
}));

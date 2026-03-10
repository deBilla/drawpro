import { create } from 'zustand';
import type { Workspace, SheetSummary } from '@drawpro/shared-types';
import { workspacesApi, sheetsApi } from '../lib/api';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: (Workspace & { sheets: SheetSummary[] }) | null;
  loading: boolean;
  error: string | null;

  fetchWorkspaces: () => Promise<void>;
  fetchWorkspace: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  createSheet: (workspaceId: string, name: string) => Promise<SheetSummary>;
  deleteSheet: (workspaceId: string, sheetId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  loading: false,
  error: null,

  async fetchWorkspaces() {
    set({ loading: true, error: null });
    try {
      const workspaces = await workspacesApi.list();
      set({ workspaces, loading: false });
    } catch (err: unknown) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  async fetchWorkspace(id) {
    set({ loading: true, error: null });
    try {
      const ws = await workspacesApi.get(id);
      set({ activeWorkspace: ws, loading: false });
    } catch (err: unknown) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  async createWorkspace(name) {
    const ws = await workspacesApi.create({ name });
    set((s) => ({ workspaces: [ws, ...s.workspaces] }));
    return ws;
  },

  async deleteWorkspace(id) {
    await workspacesApi.delete(id);
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      activeWorkspace: s.activeWorkspace?.id === id ? null : s.activeWorkspace,
    }));
  },

  async createSheet(workspaceId, name) {
    const sheet = await sheetsApi.create(workspaceId, { name });
    const summary: SheetSummary = {
      id: sheet.id,
      workspaceId: sheet.workspaceId,
      name: sheet.name,
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
}));

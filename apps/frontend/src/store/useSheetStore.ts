import { create } from 'zustand';
import type { Sheet } from '@drawpro/shared-types';
import { sheetsApi } from '../lib/api';

interface SheetState {
  currentSheet: Sheet | null;
  saving: boolean;
  lastSaved: Date | null;
  error: string | null;

  loadSheet: (workspaceId: string, sheetId: string) => Promise<void>;
  saveSheet: (
    workspaceId: string,
    sheetId: string,
    elements: unknown[],
    appState: Record<string, unknown>,
  ) => Promise<void>;
  clear: () => void;
}

export const useSheetStore = create<SheetState>()((set) => ({
  currentSheet: null,
  saving: false,
  lastSaved: null,
  error: null,

  async loadSheet(workspaceId, sheetId) {
    set({ error: null });
    try {
      const sheet = await sheetsApi.get(workspaceId, sheetId);
      set({ currentSheet: sheet });
    } catch (err: unknown) {
      set({ error: (err as Error).message });
    }
  },

  async saveSheet(workspaceId, sheetId, elements, appState) {
    set({ saving: true, error: null });
    try {
      const updated = await sheetsApi.update(workspaceId, sheetId, { elements, appState });
      set({ currentSheet: updated, saving: false, lastSaved: new Date() });
    } catch (err: unknown) {
      set({ error: (err as Error).message, saving: false });
    }
  },

  clear() {
    set({ currentSheet: null, lastSaved: null, error: null });
  },
}));

import { create } from 'zustand';
import type { Sheet } from '@drawpro/shared-types';
import { sheetsApi } from '../lib/api';
import { decryptPrivateKey, decryptSheet } from '../lib/crypto';
import { useAuthStore } from './useAuthStore';

/** Raw encrypted sheet as returned by the API (before client-side decryption). */
export interface EncryptedSheetData {
  id: string;
  workspaceId: string;
  /** '[encrypted]' sentinel — real name is inside encryptedData */
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  encryptedData: string;
}

interface SheetState {
  currentSheet: Sheet | null;
  /** Set when a sheet is encrypted and we're waiting for the user's passcode. */
  encryptedSheet: EncryptedSheetData | null;
  saving: boolean;
  lastSaved: Date | null;
  error: string | null;

  loadSheet: (workspaceId: string, sheetId: string) => Promise<void>;
  /**
   * Called from the PasscodeModal after the user types their passcode.
   * Derives the private key, decrypts the sheet (including its real name),
   * and caches the key for the session.
   */
  decryptAndLoad: (passcode: string) => Promise<void>;
  saveSheet: (
    workspaceId: string,
    sheetId: string,
    name: string,
    elements: unknown[],
    appState: Record<string, unknown>,
  ) => Promise<void>;
  clear: () => void;
}

function applyDecrypted(
  base: Omit<Sheet, 'elements' | 'appState'>,
  payload: { name: string; elements: unknown[]; appState: Record<string, unknown> },
): Sheet {
  return { ...base, name: payload.name, elements: payload.elements, appState: payload.appState };
}

export const useSheetStore = create<SheetState>()((set, get) => ({
  currentSheet: null,
  encryptedSheet: null,
  saving: false,
  lastSaved: null,
  error: null,

  async loadSheet(workspaceId, sheetId) {
    set({ error: null, encryptedSheet: null, currentSheet: null });
    try {
      const sheet = await sheetsApi.get(workspaceId, sheetId);

      if (!sheet.encryptedData) {
        set({ currentSheet: sheet });
        return;
      }

      const { cachedPrivateKey, user } = useAuthStore.getState();

      if (cachedPrivateKey) {
        const payload = await decryptSheet(sheet.encryptedData, cachedPrivateKey);
        set({ currentSheet: applyDecrypted(sheet, payload) });
        return;
      }

      if (!user?.encryptedPrivateKey) {
        set({ error: 'Sheet is encrypted but no private key is stored for this account.' });
        return;
      }

      // No cached key — PasscodeModal will handle unlock via GlobalUnlockModal
      set({
        encryptedSheet: {
          id: sheet.id,
          workspaceId: sheet.workspaceId,
          name: sheet.name,
          version: sheet.version,
          createdAt: sheet.createdAt,
          updatedAt: sheet.updatedAt,
          encryptedData: sheet.encryptedData,
        },
      });
    } catch (err: unknown) {
      set({ error: (err as Error).message });
    }
  },

  async decryptAndLoad(passcode) {
    const { encryptedSheet } = get();
    if (!encryptedSheet) return;

    const { user } = useAuthStore.getState();
    if (!user?.encryptedPrivateKey || !user.salt) {
      throw new Error('No encrypted private key found for this user.');
    }

    // Throws if wrong passcode
    const privateKeyBytes = await decryptPrivateKey(user.encryptedPrivateKey, passcode, user.salt);
    const payload = await decryptSheet(encryptedSheet.encryptedData, privateKeyBytes);

    useAuthStore.getState().setCachedPrivateKey(privateKeyBytes);

    set({
      encryptedSheet: null,
      currentSheet: {
        id: encryptedSheet.id,
        workspaceId: encryptedSheet.workspaceId,
        name: payload.name,
        elements: payload.elements,
        appState: payload.appState,
        version: encryptedSheet.version,
        createdAt: encryptedSheet.createdAt,
        updatedAt: encryptedSheet.updatedAt,
      },
    });
  },

  async saveSheet(workspaceId, sheetId, name, elements, appState) {
    set({ saving: true, error: null });
    try {
      const updated = await sheetsApi.update(workspaceId, sheetId, { name, elements, appState });

      set({
        currentSheet: updated.encryptedData
          ? { ...updated, name, elements, appState } // keep decrypted values in memory
          : updated,
        saving: false,
        lastSaved: new Date(),
      });
    } catch (err: unknown) {
      set({ error: (err as Error).message, saving: false });
    }
  },

  clear() {
    set({ currentSheet: null, encryptedSheet: null, lastSaved: null, error: null });
  },
}));

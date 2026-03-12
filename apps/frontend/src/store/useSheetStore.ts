import { create } from 'zustand';
import type { Sheet } from '@drawpro/shared-types';
import { sheetsApi } from '../lib/api';
import { decryptUserPrivateKey, decryptSheet } from '../lib/crypto';
import { useAuthStore } from './useAuthStore';

/** Raw encrypted sheet as returned by the API (before client-side decryption). */
export interface EncryptedSheetData {
  id: string;
  workspaceId: string;
  /** '[encrypted]' sentinel from the DB — real name is inside the ciphertext */
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  ephemeralPublicKey: string;
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

/** Apply decrypted payload to a sheet record, replacing name/elements/appState. */
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
      const isEncrypted =
        !!sheet.ciphertext && !!sheet.iv && !!sheet.authTag && !!sheet.ephemeralPublicKey;

      if (!isEncrypted) {
        set({ currentSheet: sheet });
        return;
      }

      const { cachedPrivateKey, user } = useAuthStore.getState();

      if (cachedPrivateKey) {
        // Key already unlocked this session — decrypt immediately
        const payload = await decryptSheet(
          sheet.ciphertext!,
          sheet.iv!,
          sheet.authTag!,
          sheet.ephemeralPublicKey!,
          cachedPrivateKey,
        );
        set({ currentSheet: applyDecrypted(sheet, payload) });
        return;
      }

      if (!user?.encryptedPrivateKey) {
        set({ error: 'Sheet is encrypted but no private key is stored for this account.' });
        return;
      }

      // No cached key — show PasscodeModal
      set({
        encryptedSheet: {
          id: sheet.id,
          workspaceId: sheet.workspaceId,
          name: sheet.name,
          version: sheet.version,
          createdAt: sheet.createdAt,
          updatedAt: sheet.updatedAt,
          ciphertext: sheet.ciphertext!,
          iv: sheet.iv!,
          authTag: sheet.authTag!,
          ephemeralPublicKey: sheet.ephemeralPublicKey!,
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
    if (!user?.encryptedPrivateKey) {
      throw new Error('No encrypted private key found for this user.');
    }

    // Throws DOMException (OperationError) on wrong passcode
    const privateKey = await decryptUserPrivateKey(user.encryptedPrivateKey, passcode);

    const payload = await decryptSheet(
      encryptedSheet.ciphertext,
      encryptedSheet.iv,
      encryptedSheet.authTag,
      encryptedSheet.ephemeralPublicKey,
      privateKey,
    );

    useAuthStore.getState().setCachedPrivateKey(privateKey);

    set({
      encryptedSheet: null,
      currentSheet: {
        id: encryptedSheet.id,
        workspaceId: encryptedSheet.workspaceId,
        name: payload.name,         // real name from inside the ciphertext
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
      const isEncrypted =
        !!updated.ciphertext && !!updated.iv && !!updated.authTag && !!updated.ephemeralPublicKey;

      set({
        currentSheet: isEncrypted
          ? { ...updated, name, elements, appState } // preserve decrypted data + real name in memory
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

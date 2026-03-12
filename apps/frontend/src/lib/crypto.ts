/**
 * Client-Controlled Encryption at Rest — frontend crypto utilities
 *
 * Key design:
 *  - User's X25519 key pair is generated in the browser.
 *  - Private key is wrapped TWO ways:
 *      1. Passcode path:  argon2id(passcode, salt) → AES-256-GCM wrapping key
 *      2. Recovery path:  HKDF-SHA256(recoveryKeyBytes) → AES-256-GCM wrapping key
 *  - The server performs ECIES (ephemeral X25519 + HKDF-SHA512 + AES-256-GCM) on
 *    save and stores the encrypted payload. The client decrypts on load.
 *  - Passcode, recovery key, and all derived keys never leave the browser.
 *
 * Browser requirements: Chrome 133+, Firefox 130+, Safari 17.4+ (X25519 in Web Crypto)
 */

import { argon2id } from 'hash-wasm';

// ─── argon2id parameters (aggressive for low-entropy 6-digit passcode) ────────
const ARGON2_MEMORY_KB = 65536; // 64 MB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const HKDF_SHEET_INFO = new TextEncoder().encode('drawpro-sheet-encryption');
const HKDF_RECOVERY_INFO = new TextEncoder().encode('drawpro-recovery-key');

// ─── Utility: base64 ↔ bytes ─────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Recovery key ─────────────────────────────────────────────────────────────

/**
 * Generate a 128-bit recovery key.
 *
 * Returns:
 *  - `bytes`: raw random bytes used to derive the AES wrapping key.
 *  - `display`: human-readable format `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`
 *               (4 groups of 8 uppercase hex chars). Safe to print / store offline.
 */
export function generateRecoveryKey(): { bytes: Uint8Array; display: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const display = (hex.match(/.{8}/g) ?? []).join('-');
  return { bytes, display };
}

/**
 * Parse a recovery key display string back to raw bytes.
 * Accepts with or without dashes, case-insensitive.
 * Throws if the format is invalid.
 */
export function parseRecoveryKey(display: string): Uint8Array {
  const hex = display.replace(/-/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(hex)) {
    throw new Error('Invalid recovery key format. Expected 32 hex characters.');
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// ─── Internal key derivation ──────────────────────────────────────────────────

/** Derive a 256-bit AES-GCM wrapping key from the user's passcode via argon2id. */
async function deriveWrappingKeyFromPasscode(
  passcode: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const rawKey = await argon2id({
    password: passcode,
    salt,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KB,
    parallelism: ARGON2_PARALLELISM,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Derive a 256-bit AES-GCM wrapping key from the recovery key bytes via HKDF-SHA256.
 *  Recovery keys have 128-bit entropy so argon2id is not needed. */
async function deriveWrappingKeyFromRecoveryKey(recoveryKeyBytes: Uint8Array): Promise<CryptoKey> {
  const hkdfBase = await crypto.subtle.importKey('raw', recoveryKeyBytes, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_RECOVERY_INFO },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ─── Key setup ────────────────────────────────────────────────────────────────

/**
 * Generate an X25519 key pair and wrap the private key two ways:
 *   1. With the passcode-derived key (argon2id) — for normal unlock.
 *   2. With the recovery-key-derived key (HKDF-SHA256) — for emergency recovery.
 *
 * Returns:
 *   - `publicKey`: base64 SPKI DER — uploaded to the server.
 *   - `encryptedPrivateKey`: JSON `{ciphertext, iv, salt}` — passcode path.
 *   - `recoveryEncryptedPrivateKey`: JSON `{ciphertext, iv}` — recovery path.
 *   - `recoveryKeyDisplay`: human-readable recovery key to show/download to user.
 */
export async function generateUserKeys(passcode: string): Promise<{
  publicKey: string;
  encryptedPrivateKey: string;
  recoveryEncryptedPrivateKey: string;
  recoveryKeyDisplay: string;
}> {
  // Generate X25519 key pair (extractable so we can export the private key)
  const keyPair = await crypto.subtle.generateKey(
    { name: 'X25519' } as EcKeyGenParams,
    true,
    ['deriveBits'],
  );

  // Export public key → SPKI DER → base64
  const pubDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKey = bytesToBase64(new Uint8Array(pubDer));

  // Export private key → PKCS8 DER (used for both wrapping operations)
  const privDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  // ── Path 1: Passcode wrapping (argon2id) ────────────────────────────────────
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passcodeWrappingKey = await deriveWrappingKeyFromPasscode(passcode, salt);
  const passcodeIv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedWithPasscode = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: passcodeIv },
    passcodeWrappingKey,
    privDer,
  );
  const encryptedPrivateKey = JSON.stringify({
    ciphertext: bytesToBase64(new Uint8Array(encryptedWithPasscode)), // includes auth tag
    iv: bytesToBase64(passcodeIv),
    salt: bytesToBase64(salt),
  });

  // ── Path 2: Recovery key wrapping (HKDF-SHA256) ────────────────────────────
  const { bytes: recoveryKeyBytes, display: recoveryKeyDisplay } = generateRecoveryKey();
  const recoveryWrappingKey = await deriveWrappingKeyFromRecoveryKey(recoveryKeyBytes);
  const recoveryIv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedWithRecovery = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: recoveryIv },
    recoveryWrappingKey,
    privDer,
  );
  const recoveryEncryptedPrivateKey = JSON.stringify({
    ciphertext: bytesToBase64(new Uint8Array(encryptedWithRecovery)), // includes auth tag
    iv: bytesToBase64(recoveryIv),
    // No salt — recovery key itself has 128-bit entropy; HKDF is sufficient
  });

  return { publicKey, encryptedPrivateKey, recoveryEncryptedPrivateKey, recoveryKeyDisplay };
}

// ─── Private key decryption ───────────────────────────────────────────────────

/**
 * Decrypt the user's X25519 private key using their passcode.
 * Throws `DOMException` (OperationError) if the passcode is wrong.
 */
export async function decryptUserPrivateKey(
  encryptedPrivateKeyJson: string,
  passcode: string,
): Promise<CryptoKey> {
  const { ciphertext, iv, salt } = JSON.parse(encryptedPrivateKeyJson) as {
    ciphertext: string;
    iv: string;
    salt: string;
  };

  const wrappingKey = await deriveWrappingKeyFromPasscode(passcode, base64ToBytes(salt));
  const privDer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    wrappingKey,
    base64ToBytes(ciphertext),
  );

  return crypto.subtle.importKey(
    'pkcs8',
    privDer,
    { name: 'X25519' } as EcKeyImportParams,
    true, // extractable so we can persist to sessionStorage
    ['deriveBits'],
  );
}

/**
 * Decrypt the user's X25519 private key using their recovery key.
 * `recoveryKeyDisplay` is the string shown to the user (e.g. `AABB1122-...`).
 * Throws `DOMException` (OperationError) if the recovery key is wrong.
 */
export async function decryptUserPrivateKeyWithRecovery(
  recoveryEncryptedPrivateKeyJson: string,
  recoveryKeyDisplay: string,
): Promise<CryptoKey> {
  const { ciphertext, iv } = JSON.parse(recoveryEncryptedPrivateKeyJson) as {
    ciphertext: string;
    iv: string;
  };

  const recoveryKeyBytes = parseRecoveryKey(recoveryKeyDisplay);
  const wrappingKey = await deriveWrappingKeyFromRecoveryKey(recoveryKeyBytes);
  const privDer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    wrappingKey,
    base64ToBytes(ciphertext),
  );

  return crypto.subtle.importKey(
    'pkcs8',
    privDer,
    { name: 'X25519' } as EcKeyImportParams,
    true, // extractable so we can persist to sessionStorage
    ['deriveBits'],
  );
}

// ─── Session persistence helpers ──────────────────────────────────────────────

/**
 * Export an X25519 private CryptoKey to a base64 PKCS8 string.
 * Used to persist the decrypted key across page reloads in sessionStorage.
 */
export async function exportPrivateKeyToSession(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
  return bytesToBase64(new Uint8Array(pkcs8));
}

/**
 * Import an X25519 private key from a base64 PKCS8 string (from sessionStorage).
 */
export async function importPrivateKeyFromSession(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    base64ToBytes(b64),
    { name: 'X25519' } as EcKeyImportParams,
    true,
    ['deriveBits'],
  );
}

// ─── Sheet decryption ─────────────────────────────────────────────────────────

/**
 * Decrypt an encrypted sheet payload using the user's X25519 private key.
 *
 * Server encrypted with ECIES:
 *   ECDH(server_ephemeral_private, user_public) → shared_secret
 *   HKDF-SHA512(shared_secret, "drawpro-sheet-encryption") → aes_key
 *   AES-256-GCM(aes_key, plaintext) → ciphertext + iv + authTag
 */
/**
 * Encrypt a short plaintext string (e.g. workspace name) with the user's own X25519 public key.
 * Uses the same ECIES scheme as the server: ephemeral X25519 + HKDF-SHA512 + AES-256-GCM.
 * Returns a JSON blob {ciphertext, iv, authTag, ephemeralPublicKey} (all base64).
 */
export async function encryptWithPublicKey(
  plaintext: string,
  userPublicKeyB64: string,
): Promise<string> {
  const userPublicKey = await crypto.subtle.importKey(
    'spki',
    base64ToBytes(userPublicKeyB64),
    { name: 'X25519' } as EcKeyImportParams,
    false,
    [],
  );

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'X25519' } as EcKeyGenParams,
    true,
    ['deriveBits'],
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: userPublicKey } as EcdhKeyDeriveParams,
    ephemeral.privateKey,
    256,
  );

  const hkdfBase = await crypto.subtle.importKey('raw', sharedSecretBits, 'HKDF', false, [
    'deriveKey',
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-512', salt: new Uint8Array(0), info: HKDF_SHEET_INFO },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  // Web Crypto AES-GCM appends 16-byte auth tag to ciphertext
  const encBytes = new Uint8Array(encrypted);
  const ctBytes = encBytes.slice(0, -16);
  const tagBytes = encBytes.slice(-16);

  const ephemeralPublicKeyDer = await crypto.subtle.exportKey('spki', ephemeral.publicKey);

  return JSON.stringify({
    ciphertext: bytesToBase64(ctBytes),
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(tagBytes),
    ephemeralPublicKey: bytesToBase64(new Uint8Array(ephemeralPublicKeyDer)),
  });
}

/**
 * Decrypt a value encrypted by encryptWithPublicKey using the user's private key.
 * Returns the original plaintext string.
 */
export async function decryptWithPrivateKey(
  encryptedJson: string,
  userPrivateKey: CryptoKey,
): Promise<string> {
  const { ciphertext, iv, authTag, ephemeralPublicKey } = JSON.parse(encryptedJson) as {
    ciphertext: string;
    iv: string;
    authTag: string;
    ephemeralPublicKey: string;
  };

  const ephPubKey = await crypto.subtle.importKey(
    'spki',
    base64ToBytes(ephemeralPublicKey),
    { name: 'X25519' } as EcKeyImportParams,
    false,
    [],
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: ephPubKey } as EcdhKeyDeriveParams,
    userPrivateKey,
    256,
  );

  const hkdfBase = await crypto.subtle.importKey('raw', sharedSecretBits, 'HKDF', false, [
    'deriveKey',
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-512', salt: new Uint8Array(0), info: HKDF_SHEET_INFO },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const ctBytes = base64ToBytes(ciphertext);
  const tagBytes = base64ToBytes(authTag);
  const combined = new Uint8Array(ctBytes.length + tagBytes.length);
  combined.set(ctBytes);
  combined.set(tagBytes, ctBytes.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv), tagLength: 128 },
    aesKey,
    combined,
  );

  return new TextDecoder().decode(decrypted);
}

// ─── Sheet decryption ─────────────────────────────────────────────────────────

/**
 * Decrypt an encrypted sheet payload using the user's X25519 private key.
 *
 * Server encrypted with ECIES:
 *   ECDH(server_ephemeral_private, user_public) → shared_secret
 *   HKDF-SHA512(shared_secret, "drawpro-sheet-encryption") → aes_key
 *   AES-256-GCM(aes_key, plaintext) → ciphertext + iv + authTag
 */
export async function decryptSheet(
  ciphertext: string,
  iv: string,
  authTag: string,
  ephemeralPublicKey: string,
  userPrivateKey: CryptoKey,
): Promise<{ name: string; elements: unknown[]; appState: Record<string, unknown> }> {
  // Import the server's ephemeral public key (SPKI DER)
  const ephPubKey = await crypto.subtle.importKey(
    'spki',
    base64ToBytes(ephemeralPublicKey),
    { name: 'X25519' } as EcKeyImportParams,
    false,
    [],
  );

  // ECDH: derive 256-bit shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: ephPubKey } as EcdhKeyDeriveParams,
    userPrivateKey,
    256,
  );

  // HKDF-SHA512: shared secret → AES-256-GCM key (matches server's hkdfSync)
  const hkdfBase = await crypto.subtle.importKey('raw', sharedSecretBits, 'HKDF', false, [
    'deriveKey',
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-512',
      salt: new Uint8Array(0),
      info: HKDF_SHEET_INFO,
    },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  // Web Crypto AES-GCM expects: ciphertext || authTag as one buffer
  const ctBytes = base64ToBytes(ciphertext);
  const tagBytes = base64ToBytes(authTag);
  const combined = new Uint8Array(ctBytes.length + tagBytes.length);
  combined.set(ctBytes);
  combined.set(tagBytes, ctBytes.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv), tagLength: 128 },
    aesKey,
    combined,
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as {
    name: string;
    elements: unknown[];
    appState: Record<string, unknown>;
  };
}

/**
 * DrawPro Client-Side E2EE — based on okara-crypto (github.com/askOkara/okara-crypto)
 *
 * Key design:
 *  - X25519 via @noble/curves (raw 32-byte keys, works on all modern browsers)
 *  - Argon2id via @phi-ag/argon2 (128 MB, 4 iterations, 2 parallelism)
 *  - Private key wrapped with AES-256-GCM (argon2id-derived key)
 *  - Recovery: 6 one-time codes (PBKDF2-SHA256) each encrypt the passcode
 *  - Sheet/workspace data: ECIES (ephemeral X25519 + HKDF-SHA512 + AES-256-GCM)
 *  - AAD used on every AES-GCM call
 *  - Wire format: eph_pub(32) | iv(16) | authTag(16) | ciphertext  — single base64 blob
 */

import initialize from '@phi-ag/argon2/fetch';
import { Argon2Type } from '@phi-ag/argon2';
import { x25519 } from '@noble/curves/ed25519';
import argon2WasmUrl from '@phi-ag/argon2/argon2.wasm?url';

// ─── Argon2id parameters ───────────────────────────────────────────────────────
const ARGON2_PARAMS = {
  memoryCost: 128 * 1024, // 128 MB
  timeCost: 4,
  parallelism: 2,
  hashLength: 32,
};

// ─── HKDF / AAD constants ─────────────────────────────────────────────────────
const HKDF_SALT = new TextEncoder().encode('drawpro-e2ee-salt');
const HKDF_INFO = new TextEncoder().encode('drawpro-e2ee-key');
const AAD_MESSAGE = new TextEncoder().encode('drawpro-e2ee-message');
const AAD_PRIVATE_KEY = new TextEncoder().encode('drawpro-e2ee-private-key');

// ─── Argon2 singleton ─────────────────────────────────────────────────────────
let argon2Instance: Awaited<ReturnType<typeof initialize>> | null = null;

async function getArgon2(): Promise<Awaited<ReturnType<typeof initialize>>> {
  if (!argon2Instance) {
    argon2Instance = await initialize(argon2WasmUrl);
  }
  return argon2Instance;
}

// ─── Uint8Array helpers ───────────────────────────────────────────────────────

/** Copy any Uint8Array into a fresh ArrayBuffer so Web Crypto is happy. */
function toBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(data.length);
  const copy = new Uint8Array(buf);
  copy.set(data);
  return copy;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Hex helpers ──────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── PEM helpers ──────────────────────────────────────────────────────────────

function privateKeyToPem(privateKeyBytes: Uint8Array): string {
  const b64 = bytesToBase64(privateKeyBytes);
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END PRIVATE KEY-----`;
}

function pemToPrivateKeyBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const decoded = base64ToBytes(b64);
  // PKCS#8 DER: look for OCTET STRING (0x04 0x20) holding the raw 32-byte key
  if (decoded.length > 32) {
    for (let i = 0; i <= decoded.length - 34; i++) {
      if (decoded[i] === 0x04 && decoded[i + 1] === 0x20) {
        const raw = decoded.slice(i + 2, i + 34);
        if (raw.length === 32) return raw;
      }
    }
    // Fallback: last 32 bytes
    return decoded.slice(-32);
  }
  return decoded; // already raw 32 bytes
}

// ─── HKDF key derivation ──────────────────────────────────────────────────────

async function deriveHKDFKey(
  sharedSecret: Uint8Array,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toBuffer(sharedSecret),
    { name: 'HKDF' },
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-512', salt: toBuffer(HKDF_SALT), info: toBuffer(HKDF_INFO) },
    keyMaterial,
    length * 8,
  );

  // Copy into a fresh ArrayBuffer (TypeScript strict)
  const result = new ArrayBuffer(length);
  new Uint8Array(result).set(new Uint8Array(bits));
  return new Uint8Array(result);
}

// ─── Key pair generation ──────────────────────────────────────────────────────

export async function generateX25519KeyPair(): Promise<{
  publicKey: string;       // base64 of raw 32 bytes
  privateKey: string;      // PEM-wrapped (used for encryptPrivateKey)
  privateKeyBytes: Uint8Array;
}> {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  const publicKeyBytes = x25519.getPublicKey(privateKeyBytes);
  return {
    publicKey: bytesToBase64(publicKeyBytes),
    privateKey: privateKeyToPem(privateKeyBytes),
    privateKeyBytes,
  };
}

// ─── Salt generation ──────────────────────────────────────────────────────────

export function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  return bytesToHex(bytes);
}

// ─── Private key encryption / decryption ─────────────────────────────────────

/** Encrypt the PEM private key with the user's passcode via Argon2id + AES-256-GCM.
 *  Returns a base64 blob: iv(16) | encrypted_pem_with_tag */
export async function encryptPrivateKey(
  privateKeyPem: string,
  passcode: string,
  salt: string,
): Promise<string> {
  const saltBytes = hexToBytes(salt);

  const argon2 = await getArgon2();
  const hashResult = argon2.hash(passcode, {
    salt: toBuffer(saltBytes),
    type: Argon2Type.Argon2id,
    memoryCost: ARGON2_PARAMS.memoryCost,
    timeCost: ARGON2_PARAMS.timeCost,
    parallelism: ARGON2_PARAMS.parallelism,
    hashLength: ARGON2_PARAMS.hashLength,
  });

  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toBuffer(new Uint8Array(hashResult.hash)),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(AAD_PRIVATE_KEY) },
    cryptoKey,
    new TextEncoder().encode(privateKeyPem),
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64(combined);
}

/** Decrypt the private key blob and return the raw 32-byte key bytes. */
export async function decryptPrivateKey(
  encryptedBase64: string,
  passcode: string,
  salt: string,
): Promise<Uint8Array> {
  const saltBytes = hexToBytes(salt);

  const argon2 = await getArgon2();
  const hashResult = argon2.hash(passcode, {
    salt: toBuffer(saltBytes),
    type: Argon2Type.Argon2id,
    memoryCost: ARGON2_PARAMS.memoryCost,
    timeCost: ARGON2_PARAMS.timeCost,
    parallelism: ARGON2_PARAMS.parallelism,
    hashLength: ARGON2_PARAMS.hashLength,
  });

  const combined = base64ToBytes(encryptedBase64);
  const iv = combined.slice(0, 16);
  const encrypted = combined.slice(16);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toBuffer(new Uint8Array(hashResult.hash)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(AAD_PRIVATE_KEY) },
    cryptoKey,
    toBuffer(encrypted),
  );

  return pemToPrivateKeyBytes(new TextDecoder().decode(decrypted));
}

// ─── Recovery codes ───────────────────────────────────────────────────────────

export interface RecoveryCodeData {
  hash: string;
  encryptedPasscode: string;
  used: boolean;
}

function generateRecoveryCode(): string {
  const buf = new Uint8Array(new ArrayBuffer(3));
  crypto.getRandomValues(buf);
  const n = ((buf[0] << 16) | (buf[1] << 8) | buf[2]) % 900000 + 100000;
  return n.toString();
}

async function hashRecoveryCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return bytesToHex(new Uint8Array(digest));
}

async function encryptPasscodeWithCode(passcode: string, code: string, salt: string): Promise<string> {
  const saltBytes = toBuffer(hexToBytes(salt));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    new TextEncoder().encode(passcode),
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToHex(combined);
}

export async function decryptPasscodeWithRecoveryCode(
  encryptedPasscode: string,
  recoveryCode: string,
  salt: string,
): Promise<string> {
  const saltBytes = toBuffer(hexToBytes(salt));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(recoveryCode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const buf = hexToBytes(encryptedPasscode);
  const iv = toBuffer(buf.slice(0, 12));
  const ct = toBuffer(buf.slice(12));

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

export async function generateRecoveryCodes(
  passcode: string,
  salt: string,
): Promise<{ recoveryCodes: string[]; recoveryCodesData: RecoveryCodeData[] }> {
  const recoveryCodes: string[] = [];
  const recoveryCodesData: RecoveryCodeData[] = [];

  for (let i = 0; i < 6; i++) {
    const code = generateRecoveryCode();
    recoveryCodes.push(code);
    recoveryCodesData.push({
      hash: await hashRecoveryCode(code),
      encryptedPasscode: await encryptPasscodeWithCode(passcode, code, salt),
      used: false,
    });
  }

  return { recoveryCodes, recoveryCodesData };
}

// ─── Session persistence ──────────────────────────────────────────────────────
// Private key is raw 32 bytes — just base64 encode/decode for sessionStorage.

export function exportPrivateKeyToSession(key: Uint8Array): string {
  return bytesToBase64(key);
}

export function importPrivateKeyFromSession(b64: string): Uint8Array {
  return base64ToBytes(b64);
}

// ─── Full key setup (called from PasscodeSetup) ───────────────────────────────

export async function generateUserKeys(passcode: string): Promise<{
  publicKey: string;
  privateKeyBytes: Uint8Array; // for immediate session caching
  encryptedPrivateKey: string;
  salt: string;
  recoveryCodes: string[];
  recoveryCodesData: string; // JSON
}> {
  const { publicKey, privateKey: pem, privateKeyBytes } = await generateX25519KeyPair();
  const salt = generateSalt();
  const encryptedPrivateKey = await encryptPrivateKey(pem, passcode, salt);
  const { recoveryCodes, recoveryCodesData } = await generateRecoveryCodes(passcode, salt);
  return {
    publicKey,
    privateKeyBytes,
    encryptedPrivateKey,
    salt,
    recoveryCodes,
    recoveryCodesData: JSON.stringify(recoveryCodesData),
  };
}

// ─── Message encryption (ECIES) ───────────────────────────────────────────────
// Wire format: eph_pub(32) | iv(16) | authTag(16) | ciphertext — single base64 blob

export async function encryptMessage(message: string, publicKeyBase64: string): Promise<string> {
  const ephPriv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  const ephPub = x25519.getPublicKey(ephPriv);

  const recipientPub = base64ToBytes(publicKeyBase64);
  const sharedSecret = x25519.getSharedSecret(ephPriv, recipientPub);
  const aesKeyBytes = await deriveHKDFKey(sharedSecret, 32);

  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    aesKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(AAD_MESSAGE) },
    cryptoKey,
    new TextEncoder().encode(message),
  );

  const encArr = new Uint8Array(encrypted);
  const ciphertext = encArr.slice(0, -16);
  const authTag = encArr.slice(-16);

  // Combine: ephPub(32) | iv(16) | authTag(16) | ciphertext
  const combined = new Uint8Array(32 + 16 + 16 + ciphertext.length);
  combined.set(ephPub, 0);
  combined.set(iv, 32);
  combined.set(authTag, 48);
  combined.set(ciphertext, 64);
  return bytesToBase64(combined);
}

export async function decryptMessage(
  encryptedBase64: string,
  privateKeyBytes: Uint8Array,
): Promise<string> {
  const buf = base64ToBytes(encryptedBase64);
  const ephPub = buf.slice(0, 32);
  const iv = buf.slice(32, 48);
  const authTag = buf.slice(48, 64);
  const ciphertext = buf.slice(64);

  const sharedSecret = x25519.getSharedSecret(privateKeyBytes, ephPub);
  const aesKeyBytes = await deriveHKDFKey(sharedSecret, 32);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    aesKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  // Reassemble ciphertext + authTag for AES-GCM
  const ctWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ctWithTag.set(ciphertext);
  ctWithTag.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(AAD_MESSAGE) },
    cryptoKey,
    toBuffer(ctWithTag),
  );

  return new TextDecoder().decode(decrypted);
}

// ─── Sheet decryption (convenience wrapper) ───────────────────────────────────

export async function decryptSheet(
  encryptedData: string,
  privateKeyBytes: Uint8Array,
): Promise<{ name: string; elements: unknown[]; appState: Record<string, unknown> }> {
  const json = await decryptMessage(encryptedData, privateKeyBytes);
  return JSON.parse(json) as { name: string; elements: unknown[]; appState: Record<string, unknown> };
}

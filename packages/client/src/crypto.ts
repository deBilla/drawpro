import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import initialize from '@phi-ag/argon2/node';
import { Argon2Type } from '@phi-ag/argon2';

/**
 * Node port of apps/frontend/src/lib/crypto.ts.
 *
 * Every constant and step here must match the browser exactly — the two sides
 * read and write the same blobs. Encryption needs only the recipient's public
 * key; decryption needs the private key, which is unwrapped from the passcode
 * locally and never transmitted.
 */

const HKDF_SALT = new TextEncoder().encode('drawpro-e2ee-salt');
const HKDF_INFO = new TextEncoder().encode('drawpro-e2ee-key');
const AAD_MESSAGE = new TextEncoder().encode('drawpro-e2ee-message');
const AAD_PRIVATE_KEY = new TextEncoder().encode('drawpro-e2ee-private-key');

const ARGON2_PARAMS = {
  memoryCost: 128 * 1024, // 128 MB
  timeCost: 4,
  parallelism: 2,
  hashLength: 32,
};

let argon2Instance: Awaited<ReturnType<typeof initialize>> | null = null;

async function getArgon2() {
  if (!argon2Instance) {
    // The package's node entry derives the wasm path from import.meta.dirname,
    // which is undefined once transpiled to CJS — resolve it explicitly.
    const require = createRequire(__filename);
    argon2Instance = await initialize(require.resolve('@phi-ag/argon2/argon2.wasm'));
  }
  return argon2Instance;
}

async function deriveHKDFKey(sharedSecret: Uint8Array): Promise<ArrayBuffer> {
  const material = await webcrypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, [
    'deriveBits',
  ]);
  return webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-512', salt: HKDF_SALT, info: HKDF_INFO },
    material,
    256,
  );
}

// ─── ECIES: sealing content for a user ───────────────────────────────────────

/** Seal `message` to `publicKeyBase64`. Wire: ephPub(32)|iv(16)|tag(16)|ciphertext. */
export async function encryptMessage(message: string, publicKeyBase64: string): Promise<string> {
  const ephemeral = (await webcrypto.subtle.generateKey({ name: 'X25519' } as EcKeyGenParams, true, [
    'deriveBits',
  ])) as CryptoKeyPair;

  const recipient = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(publicKeyBase64, 'base64'),
    { name: 'X25519' } as EcKeyImportParams,
    false,
    [],
  );

  const shared = new Uint8Array(
    await webcrypto.subtle.deriveBits(
      { name: 'X25519', public: recipient } as EcdhKeyDeriveParams,
      ephemeral.privateKey,
      256,
    ),
  );

  const aesKey = await webcrypto.subtle.importKey('raw', await deriveHKDFKey(shared), {
    name: 'AES-GCM',
  }, false, ['encrypt']);

  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const sealed = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD_MESSAGE },
      aesKey,
      new TextEncoder().encode(message),
    ),
  );

  // WebCrypto appends the tag; DrawPro's wire format carries it as its own field.
  const ciphertext = sealed.slice(0, -16);
  const authTag = sealed.slice(-16);
  const ephPub = new Uint8Array(await webcrypto.subtle.exportKey('raw', ephemeral.publicKey));

  return Buffer.concat([
    Buffer.from(ephPub),
    Buffer.from(iv),
    Buffer.from(authTag),
    Buffer.from(ciphertext),
  ]).toString('base64');
}

/** Open a blob sealed to the holder of `privateKeyBytes` (raw 32-byte X25519). */
export async function decryptMessage(
  encryptedBase64: string,
  privateKeyBytes: Uint8Array,
): Promise<string> {
  const blob = Buffer.from(encryptedBase64, 'base64');
  const ephPub = blob.subarray(0, 32);
  const iv = blob.subarray(32, 48);
  const authTag = blob.subarray(48, 64);
  const ciphertext = blob.subarray(64);

  const privateKey = await importX25519Private(privateKeyBytes);
  const publicKey = await webcrypto.subtle.importKey(
    'raw',
    ephPub,
    { name: 'X25519' } as EcKeyImportParams,
    false,
    [],
  );

  const shared = new Uint8Array(
    await webcrypto.subtle.deriveBits(
      { name: 'X25519', public: publicKey } as EcdhKeyDeriveParams,
      privateKey,
      256,
    ),
  );

  const aesKey = await webcrypto.subtle.importKey('raw', await deriveHKDFKey(shared), {
    name: 'AES-GCM',
  }, false, ['decrypt']);

  // Reassemble in the layout WebCrypto expects: ciphertext followed by tag.
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: AAD_MESSAGE },
    aesKey,
    Buffer.concat([ciphertext, authTag]),
  );

  return new TextDecoder().decode(plain);
}

// ─── Unwrapping the user's private key from their passcode ───────────────────

/** PKCS#8 wrapper for a raw X25519 private key, so webcrypto will import it. */
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

async function importX25519Private(raw: Uint8Array): Promise<CryptoKey> {
  return webcrypto.subtle.importKey(
    'pkcs8',
    Buffer.concat([PKCS8_X25519_PREFIX, Buffer.from(raw)]),
    { name: 'X25519' } as EcKeyImportParams,
    false,
    ['deriveBits'],
  );
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/** Extract the raw 32-byte key from the PEM the browser wrapped. */
function pemToPrivateKeyBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const decoded = new Uint8Array(Buffer.from(b64, 'base64'));
  if (decoded.length > 32) {
    for (let i = 0; i <= decoded.length - 34; i++) {
      if (decoded[i] === 0x04 && decoded[i + 1] === 0x20) {
        const raw = decoded.slice(i + 2, i + 34);
        if (raw.length === 32) return raw;
      }
    }
    return decoded.slice(-32);
  }
  return decoded;
}

/**
 * Turn a passcode into the account's raw private key.
 *
 * The passcode is used here and discarded; it is never sent anywhere. Argon2id
 * at 128 MB takes roughly a third of a second by design.
 */
export async function decryptPrivateKey(
  encryptedBase64: string,
  passcode: string,
  salt: string,
): Promise<Uint8Array> {
  const argon2 = await getArgon2();
  const derived = argon2.hash(passcode, {
    salt: Buffer.from(hexToBytes(salt)),
    type: Argon2Type.Argon2id,
    ...ARGON2_PARAMS,
  });

  const combined = Buffer.from(encryptedBase64, 'base64');
  const iv = combined.subarray(0, 16);
  const encrypted = combined.subarray(16);

  const aesKey = await webcrypto.subtle.importKey(
    'raw',
    new Uint8Array(derived.hash),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const pem = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: AAD_PRIVATE_KEY },
    aesKey,
    encrypted,
  );

  return pemToPrivateKeyBytes(new TextDecoder().decode(pem));
}

export interface SheetPayload {
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
}

/** Decrypt a sheet blob into the scene the editor stores. */
export async function decryptSheet(
  encryptedData: string,
  privateKeyBytes: Uint8Array,
): Promise<SheetPayload> {
  return JSON.parse(await decryptMessage(encryptedData, privateKeyBytes)) as SheetPayload;
}

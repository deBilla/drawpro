#!/usr/bin/env node
/**
 * Proves this Node port is self-consistent with the browser's scheme.
 *
 *   npx tsx packages/client/src/selftest.ts
 *
 * Covers both directions independently: sealing/opening content (ECIES), and
 * wrapping/unwrapping the account private key from a passcode (Argon2id).
 * The Argon2 step uses the same WASM binary and parameters the browser does,
 * so a passing round trip here means blobs are interchangeable with it.
 */
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import initialize from '@phi-ag/argon2/node';
import { Argon2Type } from '@phi-ag/argon2';
import { decryptMessage, decryptPrivateKey, decryptSheet, encryptMessage } from './crypto';

const AAD_PRIVATE_KEY = new TextEncoder().encode('drawpro-e2ee-private-key');
const ARGON2_PARAMS = { memoryCost: 128 * 1024, timeCost: 4, parallelism: 2, hashLength: 32 };

function ok(label: string, pass: boolean) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) process.exitCode = 1;
}

/** Mirror of the browser's encryptPrivateKey: iv(16) || AES-GCM(argon2(passcode), PEM). */
async function wrapPrivateKey(raw: Uint8Array, passcode: string, saltHex: string) {
  const require = createRequire(__filename);
  const argon2 = await initialize(require.resolve('@phi-ag/argon2/argon2.wasm'));
  const derived = argon2.hash(passcode, {
    salt: Buffer.from(saltHex, 'hex'),
    type: Argon2Type.Argon2id,
    ...ARGON2_PARAMS,
  });

  const b64 = Buffer.from(raw).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;

  const key = await webcrypto.subtle.importKey(
    'raw',
    new Uint8Array(derived.hash),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const sealed = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD_PRIVATE_KEY },
      key,
      new TextEncoder().encode(pem),
    ),
  );
  return Buffer.concat([Buffer.from(iv), Buffer.from(sealed)]).toString('base64');
}

async function main() {
  // A keypair shaped exactly like the browser's: raw 32-byte public, raw private.
  const pair = (await webcrypto.subtle.generateKey({ name: 'X25519' } as EcKeyGenParams, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicKeyB64 = Buffer.from(
    await webcrypto.subtle.exportKey('raw', pair.publicKey),
  ).toString('base64');
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  const rawPrivate = new Uint8Array(pkcs8.subarray(-32));

  // 1. Content seals and opens.
  const message = 'the quick brown fox — with an em dash and ünïcode';
  const sealed = await encryptMessage(message, publicKeyB64);
  ok('encryptMessage -> decryptMessage round trip', (await decryptMessage(sealed, rawPrivate)) === message);

  // 2. Wire format is exactly ephPub(32) | iv(16) | tag(16) | ciphertext.
  const blob = Buffer.from(sealed, 'base64');
  ok('wire format header is 64 bytes', blob.length === 64 + Buffer.byteLength(message, 'utf8'));

  // 3. A tampered blob must not open.
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0xff;
  let rejected = false;
  try {
    await decryptMessage(tampered.toString('base64'), rawPrivate);
  } catch {
    rejected = true;
  }
  ok('tampered ciphertext is rejected by the auth tag', rejected);

  // 4. Passcode unwraps the private key.
  const saltHex = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const wrapped = await wrapPrivateKey(rawPrivate, 'a-test-passcode', saltHex);
  const unwrapped = await decryptPrivateKey(wrapped, 'a-test-passcode', saltHex);
  ok('passcode -> argon2id -> private key round trip', Buffer.from(unwrapped).equals(Buffer.from(rawPrivate)));

  // 5. Wrong passcode fails rather than returning garbage.
  let wrongRejected = false;
  try {
    await decryptPrivateKey(wrapped, 'the-wrong-passcode', saltHex);
  } catch {
    wrongRejected = true;
  }
  ok('wrong passcode is rejected', wrongRejected);

  // 6. A full sheet payload survives the trip.
  const payload = { name: 'Sheet', elements: [{ id: 'a', type: 'rectangle' }], appState: { x: 1 } };
  const sheetBlob = await encryptMessage(JSON.stringify(payload), publicKeyB64);
  const back = await decryptSheet(sheetBlob, rawPrivate);
  ok('decryptSheet returns the original scene', JSON.stringify(back) === JSON.stringify(payload));
}

main().catch((err) => {
  console.error('selftest crashed:', err);
  process.exit(1);
});

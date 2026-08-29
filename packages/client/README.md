# @drawpro/client

Node client for DrawPro: personal-token auth, and the encryption scheme ported
from the browser so content can be both written **and read** outside it.

Shared core for the MCP server and the CLI.

## Reading requires the passcode

Writing needs only the account's **public** key, which the API hands out — so
creating a sheet never involves the passcode.

Reading is different. Sheet contents are sealed to the account's key pair, and
the private key is wrapped with Argon2id over the passcode. To read, this
client asks for the passcode, derives the key locally, and decrypts in process.
The passcode is never written to disk, logged, or transmitted; the server is
only ever asked for ciphertext.

That is the same trust model the browser has — it caches the unwrapped key in
`sessionStorage` for the tab's lifetime.

## Verify it against your own account

```bash
DRAWPRO_TOKEN=dp_live_... npx tsx packages/client/src/readcheck.ts
```

Prompts for the passcode (echo suppressed), unwraps the key, and lists every
sheet with its decrypted name and element count.

## Self-test

```bash
npx tsx packages/client/src/selftest.ts
```

Round-trips both directions without touching the network or a real account:
content sealing/opening, wire-format layout, tamper rejection, passcode →
private key, wrong-passcode rejection, and full scene decryption.

## Parity with the browser

Every constant matches `apps/frontend/src/lib/crypto.ts`:

| | |
|---|---|
| Key agreement | X25519 (Node webcrypto — no third-party curve library) |
| Content | AES-256-GCM, AAD `drawpro-e2ee-message` |
| KDF | HKDF-SHA512, salt `drawpro-e2ee-salt`, info `drawpro-e2ee-key` |
| Passcode → key | Argon2id, 128 MB / 4 iterations / 2 parallelism, 32 bytes |
| Private key blob | AES-256-GCM, AAD `drawpro-e2ee-private-key`, `iv(16) \| sealed` |
| Content blob | `ephPub(32) \| iv(16) \| tag(16) \| ciphertext`, base64 |

Argon2 uses the same `@phi-ag/argon2` WASM binary the frontend does, at the same
parameters, so derived keys are identical by construction.

## Write asymmetry worth knowing

`POST` requires a `name` field, which the server replaces with the
`[encrypted]` sentinel. `PUT` **rejects** a plaintext name outright for an
encrypted account — the blob is the whole update. The real name travels inside
the blob either way.

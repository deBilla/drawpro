# Encryption

> Your data is encrypted before it leaves your browser. The server only ever
> sees ciphertext.

This is the whole reason the MCP server runs on your machine rather than being
hosted: a remote server would have to receive plaintext diagrams to do its job,
which would undo everything below. Sealing and opening happen locally, exactly
as they do in the browser.

Several of the claims on this page are asserted by the eval suite rather than
only described — see [Evaluation](./evaluation.md).

---

## Why it matters

Most "secure" SaaS tools encrypt data _at rest on the server_. That still means the server can read your files — and so can anyone who compromises the server. DrawPro is different:

- **Zero knowledge** — the server never sees plaintext. Not your drawing elements, not your workspace names, not anything you put on a canvas.
- **Passcode-protected** — your private key is wrapped with a passcode only you know, derived via Argon2id (128 MB memory cost, 4 iterations). Even a stolen database is useless without the passcode.
- **Recovery-ready** — you get 6 one-time recovery codes when you enable encryption, so a forgotten passcode doesn't mean lost data.
- **Session-cached** — enter your passcode once per browser session. Your private key lives only in `sessionStorage` for the lifetime of the tab, and is wiped on logout.

---

## Cryptographic primitives

| Purpose | Algorithm |
|---|---|
| Key agreement | X25519 ECDH (ECIES pattern) |
| Content encryption | AES-256-GCM |
| Key derivation (passcode → AES key) | Argon2id — 128 MB / 4 iter / 2 par |
| Key derivation (recovery code → AES key) | PBKDF2-SHA256 — 100 000 iterations |
| KDF for ECDH shared secret → AES key | HKDF-SHA512 |
| AAD for private-key blob | `"drawpro-e2ee-private-key"` |
| AAD for all content blobs | `"drawpro-e2ee-message"` |

---

## Setup flow (first time)

```
User enables encryption
        │
        ▼
 PasscodeSetup (3 steps)
        │
        ├─ 1. Choose passcode
        │
        ├─ 2. Key generation (browser, crypto.getRandomValues)
        │       ├─ X25519 key pair (32-byte private + public)
        │       ├─ 32-byte random salt
        │       ├─ Argon2id(passcode, salt) → 32-byte wrapping key
        │       └─ AES-256-GCM(wrapping key, privateKeyPEM) → encryptedPrivateKey blob
        │
        ├─ 3. Recovery codes
        │       └─ 6 × PBKDF2-SHA256(code, salt) → AES-256-GCM(passcode) → stored
        │
        └─ PUT /auth/keys  ──►  server stores:
                                  publicKey            (base64, 32 bytes)
                                  encryptedPrivateKey  (base64, iv|AES-GCM output)
                                  salt                 (hex, 32 bytes)
                                  recoveryCodesData    (JSON array, encrypted)
```

The server receives a **public key** and an **encrypted private key blob** — never the raw private key, never the passcode.

---

## Save flow (encrypting your drawing)

```
User clicks "Save"
        │
        ▼
 Editor collects { name, elements, appState } from Excalidraw
        │
        ▼
 user.publicKey present?
        │
        YES
        ▼
 encryptMessage(JSON payload, publicKey)           ← in the browser
        │
        ├─ Generate ephemeral X25519 key pair
        ├─ X25519 ECDH(ephemeralPrivate, userPublicKey) → shared secret
        ├─ HKDF-SHA512(shared secret, salt="drawpro-e2ee-salt") → 32-byte AES key
        ├─ AES-256-GCM(AES key, payload, AAD="drawpro-e2ee-message")
        └─ Wire format: ephPub(32) | iv(16) | authTag(16) | ciphertext  →  base64
        │
        ▼
 PUT /workspaces/:wid/sheets/:id  { encryptedData }   ← only ciphertext crosses the wire
        │
        ▼
 API: stores the blob verbatim. Rejects plaintext name/elements/appState
      from any account that has keys — it never encrypts anything itself.
        │
        ▼
 Prisma: Sheet.encryptedData = base64 blob
         Sheet.name          = "[encrypted]"
         Sheet.elements      = null
         Sheet.appState      = null
```

Encryption happens **in your browser, before the request is sent**. The server holds your
public key but has no way to read what it stores. Sheet names are sealed the same way at
creation time, so a new sheet never reaches the server with a readable title.

---

## Load flow (decrypting your drawing)

```
User opens a sheet
        │
        ▼
 GET /workspaces/:wid/sheets/:id  →  { encryptedData, isEncrypted: true }
        │
        ▼
 cachedPrivateKey in sessionStorage?
        │
  YES ──┤                     NO
        │                      │
        │                      ▼
        │              GlobalUnlockModal  (passcode prompt)
        │                      │
        │              decryptPrivateKey(encryptedPrivateKey, passcode, salt)
        │                      ├─ Argon2id(passcode, salt) → wrapping key
        │                      ├─ AES-256-GCM decrypt → privateKeyPEM
        │                      └─ Extract raw 32-byte Uint8Array
        │                      │
        │              Cache raw privateKey in sessionStorage
        │                      │
        └──────────────────────┤
                               ▼
                    decryptMessage(encryptedData, privateKey)
                               ├─ Parse: ephPub(32) | iv(16) | authTag(16) | ciphertext
                               ├─ X25519 ECDH(privateKey, ephPub) → shared secret
                               ├─ HKDF-SHA512(shared secret) → AES key
                               ├─ AES-256-GCM decrypt → JSON string
                               └─ Parse { name, elements, appState }
                               │
                               ▼
                    Excalidraw renders the canvas
```

Decryption happens entirely in the browser. The server sees only an opaque ciphertext blob going out, and never the plaintext coming back.

---

## Recovery flow (forgotten passcode)

```
User enters recovery code in GlobalUnlockModal
        │
        ▼
 decryptPasscodeWithRecoveryCode(recoveryCodesData, code, salt)
        │
        ├─ PBKDF2-SHA256(code, salt, 100 000 iter) → 32-byte key
        ├─ AES-256-GCM decrypt → original passcode
        └─ Mark code as used  →  PUT /auth/keys  (updates recoveryCodesData)
        │
        ▼
 Proceed as normal load flow (passcode → private key → decrypt content)
```

Each recovery code is single-use. After use, the server records it as consumed. You start with 6; generate a new set at any time from account settings.

---

## Workspace name encryption

Workspace and sheet names follow the same ECIES path:

```
createWorkspace({ name })
        │
        ▼
 encryptMessage(name, user.publicKey)  →  encryptedName blob
        │
        ▼
 POST /workspaces  { encryptedName, name: "[encrypted]" }
        │
        ▼
 Dashboard: decryptWorkspaceNames(privateKey) runs once per session
```

Nothing on the server side reveals workspace or sheet names.

---

## Wire format reference

Every encrypted blob produced by DrawPro uses the same layout:

```
┌──────────────┬──────────┬───────────┬──────────────┐
│  ephPub (32) │  iv (16) │ tag  (16) │  ciphertext  │
└──────────────┴──────────┴───────────┴──────────────┘
                  ↑ all concatenated, then base64-encoded
```

- **ephPub** — the sender's ephemeral X25519 public key (enables ECDH without a pre-shared secret)
- **iv** — 16-byte random nonce, never reused
- **tag** — AES-GCM 128-bit authentication tag (detects any tampering)
- **ciphertext** — AES-256-GCM encrypted payload

---

## What the server can and cannot see

| Data | Server sees |
|---|---|
| Drawing elements & app state | Ciphertext only |
| Workspace & sheet names | `[encrypted]` placeholder |
| Your passcode | Never |
| Your private key | Never (only the encrypted blob) |
| Your public key | Yes — published so others can seal data to you |
| Your email / account metadata | Yes — standard account management |
| Yjs real-time collab updates | N/A — real-time collab is not enabled (future phase) |

> **Note on real-time collaboration:** Not applicable today — no Yjs client is wired up, so no
> live updates are transmitted. When collab is picked up in a future phase, encrypting the Yjs
> wire protocol needs to be designed in from the start rather than retrofitted.

---

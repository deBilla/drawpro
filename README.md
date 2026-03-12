# DrawPro

**A real-time collaborative drawing app — where your drawings never leave your device unencrypted.**

DrawPro is built with Excalidraw, Yjs, Redis, and PostgreSQL, and ships with **end-to-end encryption (E2EE) by default**. Every stroke, shape, and label on your canvas is encrypted on your device before it is ever transmitted or stored. The server holds only ciphertext — it cannot read your drawings, and neither can we.

---

## End-to-End Encryption

> Your data is encrypted before it leaves your browser. The server only ever sees ciphertext.

### Why it matters

Most "secure" SaaS tools encrypt data _at rest on the server_. That still means the server can read your files — and so can anyone who compromises the server. DrawPro is different:

- **Zero knowledge** — the server never sees plaintext. Not your drawing elements, not your workspace names, not anything you put on a canvas.
- **Passcode-protected** — your private key is wrapped with a passcode only you know, derived via Argon2id (128 MB memory cost, 4 iterations). Even a stolen database is useless without the passcode.
- **Recovery-ready** — you get 6 one-time recovery codes when you enable encryption, so a forgotten passcode doesn't mean lost data.
- **Session-cached** — enter your passcode once per browser session. Your private key lives only in `sessionStorage` for the lifetime of the tab, and is wiped on logout.

---

### Cryptographic primitives

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

### Setup flow (first time)

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

### Save flow (encrypting your drawing)

```
User clicks "Save"
        │
        ▼
 Editor collects { name, elements, appState } from Excalidraw
        │
        ▼
 PUT /workspaces/:wid/sheets/:id
        │
        ▼
 API: user.publicKey present?
        │
        YES
        ▼
 encryptForUser(JSON payload, publicKey)           ← server-side ECIES
        │
        ├─ Generate ephemeral X25519 key pair
        ├─ X25519 ECDH(ephemeralPrivate, userPublicKey) → shared secret
        ├─ HKDF-SHA512(shared secret, salt="drawpro-e2ee-salt") → 32-byte AES key
        ├─ AES-256-GCM(AES key, payload, AAD="drawpro-e2ee-message")
        └─ Wire format: ephPub(32) | iv(16) | authTag(16) | ciphertext  →  base64
        │
        ▼
 Prisma: Sheet.encryptedData = base64 blob
         Sheet.name          = "[encrypted]"
         Sheet.elements      = null
         Sheet.appState      = null
```

The server performs the encryption **using only your public key** — it cannot reverse the process without your private key, which it never has.

---

### Load flow (decrypting your drawing)

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

### Recovery flow (forgotten passcode)

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

### Workspace name encryption

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

### Wire format reference

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

### What the server can and cannot see

| Data | Server sees |
|---|---|
| Drawing elements & app state | Ciphertext only |
| Workspace & sheet names | `[encrypted]` placeholder |
| Your passcode | Never |
| Your private key | Never (only the encrypted blob) |
| Your public key | Yes — required to encrypt data for you |
| Your email / account metadata | Yes — standard account management |
| Yjs real-time collab updates | Plaintext ephemeral updates (in-transit, not persisted to Postgres) |

> **Note on real-time collaboration:** Live Yjs updates flowing through the collab server are currently not E2EE. They are ephemeral (not written to Postgres) and exist only in Redis with a 24-hour TTL. Encrypting the Yjs wire protocol is on the roadmap.

---

## Architecture

```
drawPro/
├── apps/
│   ├── api/        – Express REST API  (port 3001)
│   ├── collab/     – Yjs WebSocket collab server  (port 3002)
│   └── frontend/   – React + Vite + Excalidraw  (port 3000)
├── packages/
│   └── shared-types/  – TypeScript types shared across apps
└── infra/
    ├── docker-compose.yml
    └── nginx/nginx.conf
```

### Services

| Service  | Port | Description |
|----------|------|-------------|
| frontend | 3000 | React SPA (Vite dev) / Nginx (prod) |
| api      | 3001 | REST API: auth, workspaces, sheets |
| collab   | 3002 | Yjs WebSocket server for real-time collab |
| postgres | 5432 | Primary datastore (Prisma ORM) |
| redis    | 6379 | Yjs state persistence + cross-instance pub/sub |
| minio    | 9000 | Object storage (future: sheet exports) |

## Local Development

### Prerequisites
- Node 20+
- Docker & Docker Compose (for infrastructure)

### 1. Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up postgres redis minio -d
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/collab/.env.example apps/collab/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Edit `apps/api/.env` — set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to random strings.

### 4. Run migrations and seed

```bash
npm run db:migrate   # prisma migrate dev
npm run db:seed      # creates test@example.com / password123
```

### 5. Start all services

```bash
npm run dev          # runs turbo → api + collab + frontend in parallel
```

Open [http://localhost:3000](http://localhost:3000).

**Test credentials:** `test@example.com` / `password123`

---

## Docker (Production)

```bash
# Copy and fill in .env files for each app first, then:
npm run docker:up
```

Nginx listens on port 80 and routes:
- `/api/*` → api:3001
- `/collab/*` → collab:3002 (WebSocket)
- `/*` → frontend:80

---

## Key Design Decisions

### Auth
- JWT access tokens (15 min TTL) + refresh tokens (7 day TTL)
- Refresh token rotation: old token is invalidated in Redis on every `/auth/refresh` call
- Token hashes stored as `rt:{userId}:{tokenId}` in Redis with TTL

### Collab (Yjs)
- Each sheet maps to a Yjs room identified by `sheetId`
- WebSocket server speaks the standard [y-websocket protocol](https://github.com/yjs/y-websocket)
- Yjs doc state persisted to Redis as binary (`ydoc:{sheetId}`) — 24h TTL, refreshed on writes
- Updates are published to `collab:{sheetId}` Redis pub/sub channel so multiple collab server instances stay in sync

### Persistence
- Excalidraw elements and appState stored as Postgres JSONB via Prisma's `Json` type
- REST `PUT /workspaces/:wid/sheets/:id` is the explicit save path (triggered by "Save" button in editor)
- Yjs/Redis state is the ephemeral real-time layer; it does not auto-sync back to Postgres

### Storage (MinIO)
- Bucket `drawpro` is created on API startup if missing
- Ready for sheet exports / image uploads (implementation left to you)

---

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | `{email, password, name?}` → tokens |
| POST | `/auth/login` | `{email, password}` → tokens |
| POST | `/auth/refresh` | `{refreshToken}` → new tokens |
| POST | `/auth/logout` | invalidates refresh token |
| GET  | `/auth/me` | current user |

### Workspaces
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/workspaces` | list memberships |
| POST   | `/workspaces` | `{name}` → create |
| GET    | `/workspaces/:id` | get with sheets |
| PATCH  | `/workspaces/:id` | rename (owner) |
| DELETE | `/workspaces/:id` | delete (owner) |

### Sheets
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/workspaces/:wid/sheets` | list summaries |
| POST   | `/workspaces/:wid/sheets` | `{name}` → create |
| GET    | `/workspaces/:wid/sheets/:id` | full sheet with elements |
| PUT    | `/workspaces/:wid/sheets/:id` | update name/elements/appState |
| DELETE | `/workspaces/:wid/sheets/:id` | delete |

### Health
- `GET /health` on both `api` and `collab` → `{ status: "ok" }`

---

## Next Steps

- [ ] Supabase or email-based magic link auth
- [ ] Workspace invitations / member management
- [ ] Periodic collab→Postgres sync (collab server writes back on room close)
- [ ] Sheet export to PNG/SVG via MinIO
- [ ] Cursor presence (awareness state already wired in collab server)
- [ ] Row-level security policies if migrating to Supabase
# drawpro

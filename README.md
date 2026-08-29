# DrawPro

**A drawing app — where your drawings never leave your device unencrypted.**

DrawPro is built with Excalidraw, Redis, and PostgreSQL, and ships with **end-to-end encryption (E2EE) by default**. Every stroke, shape, and label on your canvas is encrypted on your device before it is ever transmitted or stored. The server holds only ciphertext — it cannot read your drawings, and neither can we.

> **Real-time collaboration is not enabled yet.** A Yjs WebSocket server exists in `apps/collab/`,
> but no client is wired up to it and it is disabled in Docker Compose. It is planned for a
> future phase — see [Next Steps](#next-steps).

---

## Documentation

| | |
|---|---|
| [Connect Claude Code](./docs/connect-claude-code.md) | Set up the MCP server so Claude can read and create diagrams in your account |
| [MCP tools](./docs/mcp-tools.md) | What each tool does, and which one to reach for |
| [Diagram specs](./docs/diagram-specs.md) | The authoring format, and why it has no coordinates |
| [Privacy](./docs/privacy.md) | What leaves your machine, what doesn't, and what you can turn on |
| [Operations](./docs/operations.md) | Deploys, migrations, builds |
| [Development](./docs/development.md) | Repository layout and tests |

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
| Your public key | Yes — published so others can seal data to you |
| Your email / account metadata | Yes — standard account management |
| Yjs real-time collab updates | N/A — real-time collab is not enabled (future phase) |

> **Note on real-time collaboration:** Not applicable today — no Yjs client is wired up, so no
> live updates are transmitted. When collab is picked up in a future phase, encrypting the Yjs
> wire protocol needs to be designed in from the start rather than retrofitted.

---

## Architecture

```
drawPro/
├── apps/
│   ├── api-ts/     – Express REST API  (port 3001)
│   ├── collab/     – Yjs WebSocket collab server  (port 3002) — future phase, disabled
│   ├── desktop/    – Electron desktop app (CORS-free Ollama bridge)
│   └── frontend/   – React + Vite + Excalidraw  (port 3000)
├── extensions/
│   └── ollama-cors/ – Chrome extension for Ollama CORS bypass
├── packages/
│   └── shared-types/  – TypeScript types shared across apps
└── infra/
    └── docker-compose.yml        (nginx config lives in apps/frontend/nginx.conf)
```

### Services

| Service  | Port | Description |
|----------|------|-------------|
| frontend | 3000 | React SPA (Vite dev) / Nginx (prod) |
| api      | 3001 | REST API: auth, workspaces, sheets |
| collab   | 3002 | Yjs WebSocket server — **future phase**, disabled in Docker Compose |
| postgres | 5432 | Primary datastore (Prisma ORM) |
| redis    | 6379 | Refresh-token store (+ Yjs state when collab is enabled) |
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
cp apps/api-ts/.env.example apps/api-ts/.env
cp apps/frontend/.env.example apps/frontend/.env
# cp apps/collab/.env.example apps/collab/.env   # only needed for the collab future phase
```

Edit `apps/api-ts/.env` — set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to random strings.

### 4. Run migrations and seed

```bash
npm run db:migrate   # prisma migrate dev
npm run db:seed      # creates test@example.com / password123
```

### 5. Start all services

```bash
npm run dev          # runs turbo → api + frontend in parallel
                     # collab is excluded; `npm run dev:collab` includes it
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
- `/*` → frontend:80

The `/collab/*` → collab:3002 WebSocket route is commented out in `apps/frontend/nginx.conf`,
and the `collab` service sits behind an opt-in Compose profile. Re-enable both together:

```bash
docker compose -f infra/docker-compose.yml --profile collab up
```

> nginx resolves `proxy_pass` hostnames at startup, so the location block must stay commented
> out while the collab container is absent — otherwise the frontend fails to boot with
> `[emerg] host not found in upstream "collab"`.

---

## Key Design Decisions

### Auth
- JWT access tokens (15 min TTL) + refresh tokens (7 day TTL)
- Refresh token rotation: old token is invalidated in Redis on every `/auth/refresh` call
- Token hashes stored as `rt:{userId}:{tokenId}` in Redis with TTL

### Collab (Yjs) — future phase, not active
> The server below is implemented but has **no client**: there are no Yjs imports in
> `apps/frontend/src`. It is excluded from `npm run dev`/`build` and gated behind a Compose
> profile. Recorded here as the design to resume from.

- Each sheet maps to a Yjs room identified by `sheetId`
- WebSocket server speaks the standard [y-websocket protocol](https://github.com/yjs/y-websocket)
- Yjs doc state persisted to Redis as binary (`ydoc:{sheetId}`) — 24h TTL, refreshed on writes
- Updates are published to `collab:{sheetId}` Redis pub/sub channel so multiple collab server instances stay in sync

### Persistence
- Excalidraw elements and appState stored as Postgres JSONB via Prisma's `Json` type
- REST `PUT /workspaces/:wid/sheets/:id` is the explicit save path (triggered by "Save" button in editor)
- Yjs/Redis would be the ephemeral real-time layer once collab is enabled; it does not
  auto-sync back to Postgres. Today, REST is the only save path.

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
- `GET /health` on `api` → `{ status: "ok" }` (`collab` exposes one too, when enabled)

---

## AI Feedback

DrawPro includes a built-in **AI Feedback** panel that lets you get intelligent reviews of your whiteboard content directly from the editor.

### How it works

1. Open any sheet and click the **AI Feedback** button in the toolbar
2. Configure your AI provider via the gear icon (settings are saved in your browser)
3. Send your canvas for review — the AI checks factual correctness and relationships
4. Ask follow-up questions in the same chat thread

### Supported providers

| Provider | Endpoint | API Key required |
|----------|----------|-----------------|
| **Ollama** (default) | `http://localhost:11434` | No |
| **OpenAI** | `https://api.openai.com` | Yes |
| **Anthropic** | `https://api.anthropic.com` | Yes |
| **Custom** (OpenAI-compatible) | User-provided | Optional |

### Selection-aware screenshots

When sending your canvas to the AI, DrawPro uses Excalidraw's built-in export (no browser screenshot permissions needed):

- **Nothing selected** → exports the entire canvas
- **Elements selected** → exports only the selected elements

This lets you focus the AI review on a specific part of your design.

### Privacy

- All LLM calls are made **directly from your browser** — your API keys and canvas data never pass through the DrawPro server
- Settings and keys are stored in `localStorage` only
- The server has zero knowledge of your AI configuration

---

## Desktop App (Electron)

DrawPro ships a lightweight Electron wrapper that loads the deployed web app and provides a **CORS-free bridge to local Ollama**.

### Why?

Browsers block requests from `drawpro.kithly.app` to `localhost:11434` (CORS policy). The Electron app bypasses this by routing Ollama requests through Node.js via IPC — no CORS restrictions apply.

### Build

```bash
cd apps/desktop
npm install
npm run build:mac    # macOS DMG (arm64)
npm run build:win    # Windows NSIS installer
npm run build:linux  # Linux AppImage
```

### Development

```bash
npm run dev          # start frontend first (port 3000)
cd apps/desktop
npm run dev          # launches Electron loading localhost:3000
```

### How it works

1. Electron loads the deployed site (`drawpro.kithly.app`)
2. A preload script exposes `window.electronAPI.ollamaFetch()`
3. The frontend detects Electron and routes Ollama requests through IPC
4. The main process makes the HTTP request via Node.js (no CORS)
5. OpenAI / Anthropic calls still go directly from the renderer (browser-direct)

---

## Next Steps

- [ ] Supabase or email-based magic link auth
- [ ] Workspace invitations / member management
- [ ] Sheet export to PNG/SVG via MinIO
- [ ] Row-level security policies if migrating to Supabase

### Future phase — real-time collaboration

The Yjs server in `apps/collab/` is written but unwired. Picking it up means:

- [ ] Wire a Yjs client into the frontend editor (no Yjs imports exist there today)
- [ ] Re-enable the `collab` Compose profile and the nginx `/collab/` proxy block
- [ ] Design E2EE for the Yjs wire protocol *before* wiring up, not after
- [ ] Periodic collab→Postgres sync (collab server writes back on room close)
- [ ] Cursor presence (awareness state already wired in collab server)

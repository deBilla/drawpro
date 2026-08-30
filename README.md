# DrawPro

**Diagrams your agent can actually draw.**

DrawPro is a diagramming platform built to be driven by an agent. It ships an
[MCP](https://modelcontextprotocol.io) server that lets Claude read and create
real, editable Excalidraw diagrams in your account — and because the platform is
end-to-end encrypted, that server runs on your machine, so your diagrams are
sealed before they ever reach ours.

```bash
claude mcp add drawpro --scope user -- npx -y @drawpro/mcp
```

📖 **[Documentation site](https://debilla.github.io/drawpro/)** ·
📦 **[@drawpro/mcp on npm](https://www.npmjs.com/package/@drawpro/mcp)** ·
✅ **[33/33 eval checks passing](https://debilla.github.io/drawpro/evals.html)**

---

## Why an MCP server, and not a prompt

Ask a model to write Excalidraw JSON by hand and you get overlapping boxes and
arrows bound to nothing. Coordinates are the part a language model is worst at,
and the part that decides whether a diagram is readable.

So the model never supplies them. It supplies a **spec** — what connects to what
— and layout, sizing, text wrapping and arrow binding are derived:

```json
{
  "nodes": [
    { "id": "browser", "label": "Browser" },
    { "id": "api", "label": "API" },
    { "id": "pg", "label": "Postgres", "shape": "ellipse" }
  ],
  "edges": [
    { "from": "browser", "to": "api", "label": "credentials" },
    { "from": "api", "to": "pg", "label": "look up user" }
  ]
}
```

There is nowhere in that schema to put an `x` or a `y`. Layout runs through
dagre every time, so boxes do not collide and arrows stay bound when you drag
one in the editor.

Four properties follow from that design:

| | |
|---|---|
| **Specs, not coordinates** | The schema offers no positioning fields, so the model cannot fight the layout engine |
| **Refusals that close the loop** | An edge naming a node that does not exist is refused *with that node's name*, and nothing is written — the model fixes it in the same turn |
| **Reads back as meaning** | A sheet returns as an outline of shapes and connections, not tens of thousands of characters of coordinates and style |
| **Three writing tools, not one** | Regenerating layout destroys a hand-drawn sheet, so wording changes (`edit_sheet_text`) and geometry changes (`import_sheet`) get their own tools |

[The eight tools, and which to reach for →](./docs/mcp-tools.md)

---

## Measured, not asserted

```bash
npm run eval --workspace @drawpro/mcp
```

**33/33 checks passing**, in about three seconds, with no account, no API key
and no network. The suite drives the real server over a real MCP stdio session
against a DrawPro API running in the same process, and grades what comes out:
one shape per node, arrows bound at both ends, no overlapping boxes, a refused
call that wrote nothing.

It also checks the claims it would be worst to be wrong about. The fake API
keeps every request body it was handed, so the privacy checks put a string that
exists nowhere else into a node label and then fail if that string appears in
any byte the server sent. One check fails a run outright however well the rest
went: a model asking the user to type their passcode into the conversation.

A second suite drives a **real model** through the same prompts and judges the
transcripts, with an ablation arm that removes the plugin entirely — the delta
between the arms is the number that says whether the package earns its place.

[How both suites work, and how to reproduce them →](./docs/evaluation.md)

---

## Your diagrams are encrypted before they leave your machine

> The server holds ciphertext. It cannot read your drawings, and neither can we.

This is not a footnote to the MCP story — it is the reason the MCP server is
local. A hosted remote server would have to receive plaintext diagrams to do its
job, which would undo the whole property. Running here means sealing and opening
stay on your machine, exactly as they do in the browser.

| Purpose | Algorithm |
|---|---|
| Key agreement | X25519 ECDH (ECIES pattern) |
| Content encryption | AES-256-GCM |
| Passcode → key | Argon2id — 128 MB / 4 iterations / 2 parallelism |
| Recovery code → key | PBKDF2-SHA256, 100 000 iterations |
| ECDH shared secret → AES key | HKDF-SHA512 |

- **Zero knowledge.** Not your elements, not your workspace names, not your
  sheet titles — names are sealed at creation, so the server only ever sees
  `[encrypted]`. A dashboard of readable titles would leak the shape of
  everything you work on.
- **The passcode never enters the chat.** Reading needs your private key, which
  an interactive `npx -y @drawpro/mcp login` unwraps once and stores in the OS
  keychain. It is never a tool argument, so it never reaches the model's
  context. When a tool hits a locked account it relays that instruction — and is
  explicitly forbidden from asking you for the passcode itself.
- **Even a stolen database is useless.** The private key is wrapped with a
  passcode only you know; the server stores the wrapped blob and never the key.
- **Recovery-ready.** Six one-time recovery codes, so a forgotten passcode does
  not mean lost work.

[The full scheme, wire format, and what the server can never see →](./docs/encryption.md)

---

## Documentation

| | |
|---|---|
| [Connect Claude Code](./docs/connect-claude-code.md) | Set up the MCP server so Claude can read and create diagrams in your account |
| [MCP tools](./docs/mcp-tools.md) | What each tool does, and which one to reach for |
| [Diagram specs](./docs/diagram-specs.md) | The authoring format, and why it has no coordinates |
| [Evaluation](./docs/evaluation.md) | How the server is measured, and how to reproduce it |
| [Tool lifecycle](./docs/tool-lifecycle.md) | Designing, testing, publishing and judging an MCP tool |
| [Encryption](./docs/encryption.md) | The scheme, the wire format, and what the server can never see |
| [Privacy](./docs/privacy.md) | What leaves your machine, what doesn't, and what you can turn on |
| [Operations](./docs/operations.md) | Deploys, migrations, builds |
| [Development](./docs/development.md) | Repository layout and tests |

---

## The rest of the platform

Everything below is the application the MCP server writes into: a React +
Excalidraw editor, an Express API, Postgres and Redis. You do not need any of it
to use the MCP server — [connect Claude Code](./docs/connect-claude-code.md) and
you are done — but it is what your diagrams live in.

> **Real-time collaboration is not enabled yet.** A Yjs WebSocket server exists in `apps/collab/`,
> but no client is wired up to it and it is disabled in Docker Compose. It is planned for a
> future phase — see [Next Steps](#next-steps).

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
│   ├── mcp/           – the MCP server, its eval suites, and the Claude Code plugin
│   ├── diagram/       – spec → Excalidraw: layout, text measurement, validation
│   ├── client/        – Node DrawPro client: API calls, crypto, keystore
│   └── shared-types/  – TypeScript types shared across apps
├── site/              – the GitHub Pages site, built from docs/ by build.mjs
└── infra/
    └── docker-compose.yml        (nginx config lives in apps/frontend/nginx.conf)
```

`packages/mcp` and its two workspace dependencies are the part this repository
leads with. `diagram` holds everything with real behaviour — layout, font
metrics, validation — so it can be unit-tested in milliseconds without a server;
`client` holds the API and crypto so the same sealing code runs in the MCP
server and the CLI. See [Development](./docs/development.md).

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

**Google sign-in (Firebase).** Firebase answers exactly one question — "did this
browser really sign in as this Google account?" — and is then out of the picture.
The browser runs `signInWithPopup`, posts the resulting ID token to
`POST /auth/google`, and the API verifies it with `firebase-admin` before issuing
the *same* session cookies a password login produces. Consequences:

- Google users are indistinguishable to every other route; refresh rotation, API
  tokens and the E2EE passcode gate work unchanged.
- The Firebase session is signed out immediately after the token is read, so there
  is never a second source of truth for "am I logged in".
- `User.passwordHash` is nullable: a Google-only account has none, and `/auth/login`
  answers such an address with a 409 pointing at the Google button.
- Accounts are linked by email **only when Google reports it verified** — otherwise
  a token for an unverified address could claim someone else's account.
- Unset `FIREBASE_*` (server) or `VITE_FIREBASE_*` (client) disables the feature:
  the API returns 503 on `/auth/google` and the button hides itself.

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
| POST | `/auth/google` | `{idToken}` (Firebase) → tokens; creates or links the account |
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

- [x] Google sign-in via Firebase
- [ ] Email-based magic link auth
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

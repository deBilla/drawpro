# DrawPro

A real-time collaborative drawing app built with Excalidraw, Yjs, Redis, and PostgreSQL.

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

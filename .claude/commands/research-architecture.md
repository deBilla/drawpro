Analyze and explain the DrawPro system architecture.

Explore the codebase and provide a clear explanation of:

1. **Service topology** — how frontend, api, collab, postgres, redis, and minio connect. Read `infra/docker-compose.yml` and `apps/frontend/vite.config.ts` (proxy setup) for the full picture.
2. **Request flow** — trace how a typical user action flows through the system (e.g., creating a sheet, real-time collaboration, saving)
3. **Authentication flow** — JWT access/refresh token lifecycle, read `apps/api/src/routes/auth.ts` and `apps/frontend/src/lib/api.ts`
4. **E2EE flow** — how encryption works end-to-end, read `apps/frontend/src/lib/crypto.ts`, `apps/frontend/src/components/PasscodeSetup.tsx`, and the sheet encryption in `apps/api/src/routes/sheets.ts`
5. **Real-time collaboration** — Yjs protocol, Redis persistence and pub/sub, read `apps/collab/src/lib/ydoc.ts` and `apps/frontend/src/components/Canvas.tsx`
6. **Data model** — read `apps/api/prisma/schema.prisma` and explain entity relationships

If I specify a specific area (e.g., "auth", "collab", "encryption"), focus the deep-dive on that area only.

Use diagrams (ASCII or mermaid) where helpful.

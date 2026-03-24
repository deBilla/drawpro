Verify that the local development environment is correctly configured for DrawPro.

Check the following and report status for each:

1. **Node & npm** — verify node >= 20 and npm >= 10
2. **Dependencies** — check if `node_modules` exist at root and in each app (apps/api, apps/frontend, apps/collab). If missing, suggest `npm install` from root.
3. **Environment files** — for each app (api, frontend, collab), check if `.env` exists. If not, check `.env.example` and list which env vars need to be set.
4. **Database** — check if DATABASE_URL is configured in apps/api/.env. Run `npx prisma migrate status` in apps/api to check migration state.
5. **Redis** — check if REDIS_URL is set. Try `redis-cli ping` to see if Redis is reachable.
6. **MinIO** — check if MINIO_* vars are set in apps/api/.env.
7. **TypeScript** — run `npx tsc --noEmit` in each app to check for type errors.

Summarize results as a checklist with pass/fail for each item and actionable fixes for any failures.

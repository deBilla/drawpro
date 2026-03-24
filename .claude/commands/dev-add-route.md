Help me add a new API route to the DrawPro backend.

I'll describe what the route should do. You should:

1. **Determine the right file** — check existing routes in `apps/api/src/routes/` (auth.ts, workspaces.ts, sheets.ts) to see if this belongs in an existing router or needs a new one.
2. **Follow existing patterns** — use the same style as existing routes:
   - Zod schema for request validation using the validate middleware from `apps/api/src/middleware/validate.ts`
   - `requireAuth` middleware from `apps/api/src/middleware/auth.ts` for protected routes
   - Prisma queries via the singleton from `apps/api/src/lib/prisma.ts`
   - Consistent error handling with try/catch and proper HTTP status codes
   - Response envelope: `{ data: T }` for success
3. **Update shared types** — if new request/response types are needed, add them to `packages/shared-types/src/index.ts`
4. **Mount the router** — if creating a new route file, register it in `apps/api/src/index.ts`

Ask me what the route should do if I haven't specified it.

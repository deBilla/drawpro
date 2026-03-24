Help me scope a new feature for DrawPro.

I'll describe the feature I want to build. You should:

**1. Requirements Analysis**
- Break down the feature into user stories
- Identify acceptance criteria for each story
- List assumptions and open questions

**2. Technical Scope**
Analyze what needs to change in each layer:
- **Database** — new models or fields in `apps/api/prisma/schema.prisma`?
- **Shared types** — new types in `packages/shared-types/src/index.ts`?
- **API routes** — new endpoints or modifications to existing routes in `apps/api/src/routes/`?
- **API middleware** — new middleware needed in `apps/api/src/middleware/`?
- **Frontend pages** — new pages in `apps/frontend/src/pages/`?
- **Frontend components** — new or modified components in `apps/frontend/src/components/`?
- **Frontend stores** — new or modified Zustand stores in `apps/frontend/src/store/`?
- **Collab server** — changes to WebSocket protocol in `apps/collab/src/`?
- **Infrastructure** — new services, env vars, Docker changes?

**3. Effort Estimate**
- List each piece of work as S/M/L
- Identify dependencies between pieces
- Suggest an implementation order

**4. Risks & Edge Cases**
- Security implications (especially around auth and E2EE)
- Migration risks (data loss, breaking changes)
- Performance concerns

Ask me what feature to scope if I haven't specified one.

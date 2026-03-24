Review a pull request for the DrawPro repository.

If a PR number is provided as argument, fetch it with `gh pr view $ARGUMENTS --json title,body,files,additions,deletions,commits` and `gh pr diff $ARGUMENTS`.

If no PR number is given, review the current branch's changes against main: `git diff main...HEAD`.

Perform a comprehensive review:

1. **Summary** — what does this PR do? Does the description match the actual changes?

2. **File-by-file review** — for each changed file:
   - Read the full file (not just the diff) to understand context
   - Check correctness, security, type safety, error handling
   - Verify consistency with DrawPro patterns (Zod validation, requireAuth middleware, Prisma queries, Zustand stores, API client patterns)

3. **Architecture check**:
   - Are shared types updated in `packages/shared-types/src/index.ts`?
   - Are new routes mounted in `apps/api/src/index.ts`?
   - Are new pages added to the router in `apps/frontend/src/App.tsx`?
   - Does the Prisma schema need a migration?

4. **Security review**:
   - Auth middleware on all protected routes?
   - Input validation with Zod on all endpoints accepting data?
   - No secrets or credentials in the diff?
   - E2EE handling correct if touching encrypted fields?

5. **Output format**:
   - Start with a 1-2 sentence overall assessment
   - List findings by severity (🔴 Critical → 🟡 Warning → 🟢 Suggestion)
   - End with an approve/request-changes recommendation

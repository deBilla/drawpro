Review recent code changes in the DrawPro repository.

Analyze the changes and provide a thorough code review:

1. **Get the diff** — run `git diff` for unstaged changes, or `git diff HEAD~$ARGUMENTS` for recent commits (default: HEAD~1). If I provide a branch name, diff against that.

2. **Review each changed file** for:
   - **Correctness** — logic errors, off-by-one, null/undefined risks, async/await issues
   - **Security** — injection risks, auth bypasses, sensitive data exposure, missing validation
   - **Type safety** — proper TypeScript usage, any-casts, missing types
   - **Error handling** — unhandled promise rejections, missing try/catch, generic error swallowing
   - **Consistency** — follows existing patterns in the codebase (check surrounding code)
   - **Performance** — N+1 queries, unnecessary re-renders, missing indexes

3. **Cross-cutting concerns**:
   - Are shared types in `packages/shared-types` updated if API contracts changed?
   - Are Prisma migrations needed for schema changes?
   - Is the API client in `apps/frontend/src/lib/api.ts` updated for new endpoints?

4. **Present findings** as:
   - 🔴 **Critical** — must fix before merge (security, data loss, crashes)
   - 🟡 **Warning** — should fix (bugs, bad patterns)
   - 🟢 **Suggestion** — nice to have (style, minor improvements)

Include file path, line number, and specific fix suggestion for each finding.

Run TypeScript type checking across the DrawPro monorepo.

Execute `npx tsc --noEmit` in each app directory and report results:

1. **apps/api** — `cd apps/api && npx tsc --noEmit`
2. **apps/frontend** — `cd apps/frontend && npx tsc --noEmit`
3. **apps/collab** — `cd apps/collab && npx tsc --noEmit`
4. **packages/shared-types** — `cd packages/shared-types && npx tsc --noEmit`

For each:
- Report pass/fail
- If there are errors, show them grouped by file
- Suggest fixes for each error, referencing the relevant tsconfig and source files

Run all four checks in parallel for speed.

At the end, provide a summary table:
| Package | Status | Errors |
|---------|--------|--------|

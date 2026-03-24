Review the DrawPro database schema for correctness and best practices.

Read `apps/api/prisma/schema.prisma` and analyze:

1. **Model design** — are entities well-structured? Proper normalization? Missing fields?
2. **Relationships** — are foreign keys and relations correctly defined? Cascade rules appropriate?
3. **Indexes** — are there indexes on frequently queried fields? Check for missing indexes on:
   - Foreign keys used in WHERE clauses
   - Fields used in unique constraints
   - Fields used in ORDER BY
4. **Types** — are field types appropriate? (e.g., String vs Text for large content, DateTime precision)
5. **Defaults** — are defaults sensible? (cuid for IDs, now() for timestamps)
6. **Migrations** — review migration history in `apps/api/prisma/migrations/` for any risky operations (data loss, long locks)
7. **Consistency** — do naming conventions match across models?

Also check that all Prisma queries in the route handlers (`apps/api/src/routes/*.ts`) are efficient — look for N+1 patterns, missing includes, unnecessary selects.

Present findings with specific ALTER suggestions or Prisma schema changes.

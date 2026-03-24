Perform a security audit of the DrawPro codebase.

Conduct a thorough security review covering OWASP Top 10 and application-specific concerns:

**1. Authentication & Session Management**
- Review JWT implementation in `apps/api/src/routes/auth.ts` and `apps/api/src/middleware/auth.ts`
- Check token storage, refresh rotation, and revocation in Redis
- Review password hashing (bcrypt) configuration
- Check for timing attacks in auth comparisons

**2. Input Validation & Injection**
- Audit all route handlers for proper Zod validation
- Check Prisma queries for any raw SQL usage
- Review for command injection, path traversal
- Check frontend for XSS vectors (dangerouslySetInnerHTML, unsanitized rendering)

**3. Authorization**
- Verify all protected routes use `requireAuth` middleware
- Check for IDOR vulnerabilities — can users access other users' workspaces/sheets?
- Review workspace membership checks

**4. Cryptography**
- Audit E2EE implementation in `apps/frontend/src/lib/crypto.ts`
- Review key derivation (Argon2id parameters)
- Check encrypted data handling in `apps/api/src/routes/sheets.ts`
- Verify no plaintext secrets in code or configs

**5. Infrastructure**
- Review CORS configuration in `apps/api/src/index.ts`
- Check helmet configuration
- Review rate limiting setup
- Audit docker-compose for exposed ports and default credentials
- Check .env.example files for secure defaults

**6. Dependencies**
- Run `npm audit` for known vulnerabilities

Present findings grouped by severity with specific remediation steps.

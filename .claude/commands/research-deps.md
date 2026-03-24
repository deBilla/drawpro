Analyze dependencies for the DrawPro monorepo.

Check the following:

1. **Dependency inventory** — list key dependencies for each app (api, frontend, collab) grouped by category (framework, database, auth, crypto, UI, dev tools)
2. **Version analysis** — identify any outdated packages by running `npm outdated` at the root
3. **Duplicate dependencies** — check if the same package appears at different versions across apps
4. **Security audit** — run `npm audit` and summarize any vulnerabilities found
5. **Bundle impact (frontend)** — identify the largest dependencies that affect frontend bundle size
6. **Shared types usage** — verify that `packages/shared-types` is correctly referenced and used across apps

If I specify an argument like "security" or "outdated", focus only on that aspect.

Present findings in a clear table format with actionable recommendations.

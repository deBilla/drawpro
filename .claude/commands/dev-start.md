Help me start DrawPro services for local development.

Based on what I want to work on, suggest and run the appropriate start command:

- **Full stack (no collab):** `npm run dev` from project root — starts frontend (3000) + api (3001)
- **Full stack (with collab):** `npm run dev:collab` — starts all three services
- **Docker stack:** `npm run docker:up` — starts everything via docker-compose including postgres, redis, minio

If I specify an argument like "api" or "frontend" or "collab", start only that service by running its dev script directly (e.g., `cd apps/api && npm run dev`).

Before starting, do a quick check:
1. Are dependencies installed? (`node_modules` exists)
2. Are .env files in place for the services being started?

Report which services are starting and on which ports.

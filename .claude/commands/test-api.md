Test a DrawPro API endpoint manually.

I'll specify which endpoint to test. You should:

1. **Find the route** — locate the handler in `apps/api/src/routes/` and understand what it expects (method, path, body schema, auth requirement)
2. **Check prerequisites** — verify the API is running on port 3001, check if auth is needed
3. **Build the curl command** — construct the appropriate curl request:
   - For auth-required routes: first call `POST /auth/login` with test credentials (test@example.com / password123) to get a token
   - Include proper headers (Content-Type, Authorization Bearer)
   - Include request body matching the Zod validation schema
4. **Execute and analyze** — run the curl command and analyze the response
5. **Report** — show the request, response status, response body, and whether it matches expected behavior

Common test scenarios:
- `auth` — test register → login → refresh → me → logout flow
- `workspaces` — test CRUD operations
- `sheets` — test sheet creation and retrieval under a workspace

If the API isn't running, suggest starting it with `cd apps/api && npm run dev`.

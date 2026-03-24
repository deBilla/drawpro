Trace a feature or user action through the entire DrawPro stack.

I'll describe a user action (e.g., "user logs in", "user creates a workspace", "user draws on canvas and saves"). You should:

1. **Frontend** — find the UI component/page that initiates this action, trace through event handlers, store actions, and API calls
2. **API client** — show the relevant call in `apps/frontend/src/lib/api.ts`
3. **API route** — find the Express route handler, trace through middleware (auth, validation), business logic, and database queries
4. **Database** — show the Prisma query and relevant schema models
5. **Collab (if applicable)** — trace WebSocket message flow through `apps/collab/src/lib/ydoc.ts`

For each step, reference the exact file and line numbers. Present the trace as a numbered sequence showing data transformations at each layer.

Ask me what action to trace if I haven't specified one.

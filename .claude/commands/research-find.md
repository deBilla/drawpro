Search the DrawPro codebase for a specific concept, pattern, or implementation.

I'll tell you what I'm looking for. You should:

1. **Search broadly** — use grep/glob across all apps and packages to find relevant code
2. **Show context** — for each match, show the surrounding code with file path and line numbers
3. **Explain connections** — describe how the found code pieces relate to each other
4. **Trace usage** — show where functions/types/components are imported and used
5. **Suggest related code** — point to related implementations the user might also want to look at

Focus the search across:
- `apps/api/src/` — backend routes, middleware, config
- `apps/frontend/src/` — pages, components, stores, lib
- `apps/collab/src/` — WebSocket server, Yjs protocol
- `packages/shared-types/src/` — shared type definitions

Present results organized by relevance, not by file path.

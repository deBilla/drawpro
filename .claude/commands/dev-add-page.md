Help me add a new page to the DrawPro frontend.

I'll describe what the page should do. You should:

1. **Create the page component** in `apps/frontend/src/pages/` following existing patterns (Login.tsx, Register.tsx, Dashboard.tsx, Editor.tsx)
2. **Add the route** in `apps/frontend/src/App.tsx` using React Router v7 — determine if it needs authentication (wrap in the auth-gated section) or is public
3. **Use existing stores** where applicable:
   - `useAuthStore` from `src/store/useAuthStore.ts` for auth state
   - `useWorkspaceStore` from `src/store/useWorkspaceStore.ts` for workspace/sheet data
   - `useSheetStore` from `src/store/useSheetStore.ts` for sheet operations
4. **Use the API client** from `src/lib/api.ts` for backend calls — follow the existing pattern with the axios instance that has auto-refresh
5. **Add shared types** to `packages/shared-types/src/index.ts` if needed
6. **Style consistently** with existing pages (check Dashboard.tsx and Editor.tsx for the current styling approach)

Ask me what the page should do if I haven't specified it.

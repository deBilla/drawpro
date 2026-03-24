Run a database operation for the DrawPro API.

Supported operations (pass as argument, e.g., `/dev-db migrate`):

- **migrate** — Run `npx prisma migrate dev` in apps/api to apply pending migrations
- **seed** — Run `npm run db:seed` to seed test data (test@example.com / password123)
- **reset** — Run `npx prisma migrate reset` in apps/api (WARNING: drops all data)
- **studio** — Run `npx prisma studio` in apps/api to open the visual DB browser
- **status** — Run `npx prisma migrate status` in apps/api to show migration state
- **generate** — Run `npx prisma generate` in apps/api to regenerate the Prisma client
- **schema** — Read and display the current Prisma schema from apps/api/prisma/schema.prisma

If no argument is provided, show the list of available operations and current migration status.

Always run prisma commands from the `apps/api` directory.

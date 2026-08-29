# Operations

## Deploys

Pushing to `main` triggers `.github/workflows/deploy.yml`, which copies the repo
to the server, builds images, runs migrations, and starts services.

```
Prepare server → Copy files → Setup env → Build images → Run migrations → Start services
```

**No teardown.** The start step is `docker compose up -d` with no preceding
`down`, so only services whose image or configuration changed are recreated.
Postgres, Redis, and MinIO are left running.

This matters more than it sounds. `down` took the whole site offline for the
length of every deploy, and anyone hitting it in that window got a Cloudflare
502 with no explanation — including the database, which was restarted on every
push for no reason.

`--remove-orphans` is deliberately not used: Postgres was an undeclared orphan
until recently, and if a service ever falls out of the compose file again, that
flag would delete its container on the next deploy.

## Migrations

`prisma migrate deploy` runs between building images and starting services, so a
schema change arrives with the code that needs it. The API image carries the
Prisma CLI because it is a devDependency and `npm ci` installs devDependencies.

Before this existed, the schema was only ever advanced by hand — which meant
code could deploy referencing a table that did not exist.

### Validating a migration before it ships

Apply it to a throwaway database on the server and ask Prisma whether the
migration history reproduces `schema.prisma` exactly:

```bash
docker exec infra-postgres-1 psql -U drawpro -d postgres \
  -c "CREATE DATABASE drawpro_mcheck;"

docker run --rm --network container:infra-postgres-1 \
  -v /tmp/prisma-check:/w -w /w \
  -e DATABASE_URL='postgresql://drawpro@localhost:5432/drawpro_mcheck' \
  node:20-alpine sh -c '
    apk add --no-cache openssl
    npx -y prisma@5.22.0 migrate deploy
    npx -y prisma@5.22.0 migrate diff \
      --from-url "$DATABASE_URL" --to-schema-datamodel schema.prisma --exit-code
  '
```

Exit code 0 means no drift. Sharing the Postgres container's network namespace
reaches it on `127.0.0.1`, which `pg_hba.conf` grants `trust` — avoiding
quoting a password through three shell layers.

## Reproducible builds

Dockerfiles copy `package-lock.json` and use `npm ci`, so images install exactly
what the lockfile pins.

They previously ran `npm install` without the lockfile, and the deploy builds
with `--no-cache`, so every deploy re-resolved every `^range` against whatever
was newest that day. A dependency release could break production with no code
change at all.

Each Dockerfile copies only its own workspace's `package.json`, so `npm ci`
installs just that subtree: api-ts 256 packages, collab 150, frontend 415.
Copying every workspace manifest instead would install 983, including Electron,
into the API image.

## Body size limits

nginx and the API must agree. nginx defaults to 1MB; the API allows 10MB. When
they disagreed, a large sheet was rejected at the proxy with a 413 the API never
saw and never logged. Both are now 10MB.

## Services

| Service | Port | |
|---|---|---|
| frontend | 80 | Nginx serving the SPA, proxying `/api/` |
| api | 3001 | Express REST API |
| postgres | 5432 | Primary datastore |
| redis | 6379 | Refresh-token store |
| minio | 9000 | Object storage |
| collab | 3002 | Yjs — behind the `collab` profile, off by default |

Real-time collaboration is not enabled: the server exists but no client is wired
to it. Re-enable with `docker compose --profile collab up`, and restore the
`/collab/` block in `apps/frontend/nginx.conf` at the same time — nginx resolves
`proxy_pass` hostnames at startup, so an active block with no container fails
the frontend's boot.

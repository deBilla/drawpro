Help me with Docker operations for DrawPro.

Supported operations (pass as argument):

- **up** — `docker compose -f infra/docker-compose.yml up -d --build` to build and start all services
- **down** — `docker compose -f infra/docker-compose.yml down` to stop all services
- **logs** — `docker compose -f infra/docker-compose.yml logs -f` (add service name to filter, e.g., `logs api`)
- **ps** — `docker compose -f infra/docker-compose.yml ps` to show running containers
- **rebuild** — `docker compose -f infra/docker-compose.yml up -d --build --no-cache` to force full rebuild
- **clean** — `docker compose -f infra/docker-compose.yml down -v` to stop and remove volumes (WARNING: destroys data)
- **shell** — Open a shell in a running container (specify service name)

If no argument is provided, show container status with `docker compose ps`.

Always use the compose file at `infra/docker-compose.yml`.

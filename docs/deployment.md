# Deployment

dtcc-infra builds the images from a pinned commit and runs them on the `twin` host (`twin.dtcc.chalmers.se`), as it
does for the Engine. [`compose.prod.yaml`](../compose.prod.yaml) is the reference stack; `pnpm check:prod` builds and
checks it locally. The Engine is not part of it: the backend reaches it through the API gateway.

## Images

Built from the repository root. Base images are pinned by digest, for `linux/amd64` and `linux/arm64`.

| Image   | Build                                                                   | Runs                                                     |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| backend | `docker build --file apps/backend/Dockerfile --target prod <checkout>`  | `node dist/main.js` on 3030, uid 10001                   |
| web     | `docker build --file apps/frontend/Dockerfile --target prod <checkout>` | nginx on 8080, uid 101; proxies `/api` to `backend:3030` |

## Services

| Service  | Image           | Role                                    | Health                  |
| -------- | --------------- | --------------------------------------- | ----------------------- |
| postgres | `postgres:18.6` | Database, internal network only         | `pg_isready`            |
| migrate  | backend         | `node dist/migrate.js`, then exits      | exit code 0             |
| backend  | backend         | The API                                 | `GET /api/health/ready` |
| web      | web             | Public HTTP entry point, read-only root | `GET /healthz`          |

They start in that order.

## Releases

Build both images, run `migrate`, recreate `backend` and `web`. Migrations only go forward. A release has a migration
when it changes `apps/backend/drizzle/`.

## Settings

Two files in `TWIN_SETTINGS_DIR` (default `/etc/dtcc-twin`), mode 600, never in Git or an image.

| File         | Variable           | Value                                                                       |
| ------------ | ------------------ | --------------------------------------------------------------------------- |
| postgres.env | POSTGRES_PASSWORD  | Random, generated once                                                      |
| backend.env  | DATABASE_URL       | `postgres://twin:<POSTGRES_PASSWORD>@postgres:5432/twin`                    |
|              | JWT_SECRET         | Random, at least 32 characters, generated once                              |
|              | ENGINE_URL         | `https://api.dtcc.chalmers.se/engine`                                       |
|              | ENGINE_GATEWAY_KEY | The Twin backend consumer's key, listed in the gateway's `ENGINE_CONSUMERS` |
|              | ENGINE_API_TOKEN   | Empty: the gateway supplies it                                              |
|              | APISIX_ADMIN_URL   | The private Admin API endpoint (T3); empty until then                       |
|              | APISIX_ADMIN_KEY   | The backend's Admin API credential                                          |
|              | ADMIN_EMAIL        | The first admin, created by `migrate` while there is no active admin        |
|              | ADMIN_PASSWORD     | That admin's password, at least 8 characters                                |

Empty engine or gateway settings leave those routes answering 503. If the Admin API's certificate is not publicly
trusted, mount its CA and set `NODE_EXTRA_CA_CERTS`.

## State

| State        | Volume → path                              |
| ------------ | ------------------------------------------ |
| Database     | `postgres-data` → `/var/lib/postgresql`    |
| Job packages | `packages` → `/var/lib/dtcc-twin/packages` |

Both volumes and `TWIN_SETTINGS_DIR` belong on a retained data disk, so a replaced host keeps them: a new
`POSTGRES_PASSWORD` would not open the existing database. Packages must be writable by uid 10001.

## Network

- **Inbound:** the web server's 8080 only, behind TLS. Postgres and the backend publish no port.
- **Outbound (backend):** `api.dtcc.chalmers.se:443`, and the private Admin API through Twin's private interface.
- **TLS** is terminated in front of the web server and is required: production auth cookies are `Secure`, so login
  fails over HTTP. Redirect HTTP to HTTPS and set HSTS.
- **The TLS proxy** forwards everything to `web:8080` and must not buffer responses, since job packages stream. It
  allows request bodies of at least 4 MB and waits at least 120 s for a response, as the web server does.

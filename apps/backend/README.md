# Backend

NestJS 12 on Express, serving everything under `/api`, with Drizzle over a `pg` pool.

API reference: Swagger UI at <http://localhost:3030/api/docs> outside production.

## Layout

```
src/
  main.ts, app.setup.ts   bootstrap; configureApp() is shared with the e2e tests
  app.module.ts           every module is imported here
  config/                 env schema, validated once at boot
  common/                 decorators, error handling, request id
  infra/database/         pool, shared columns, relations.ts
  infra/engine/           EngineClient: the only code that calls DTCC Engine
  infra/storage/          PackageStorage: the packages of completed jobs
  docs/                   OpenAPI document and Swagger UI
  modules/<name>/         controller → service → repository, plus table and module
scripts/                  db:seed
test/                     e2e specs and their helpers
```

## A request, end to end

1. **Request id**: every request gets one, returned in `X-Request-Id` and in any error body.
2. **AuthGuard** (global): every route is admin-only unless it declares `@Roles(…)` or `@Public()`.
3. **Validation pipe** (global): each `@Body`/`@Query`/`@Param` declared with `{ schema }` is parsed with its contract. A failure is a 400 `VALIDATION_FAILED` listing each issue.
4. **Handler → service → repository.**
5. **Serializer** (global): the response is parsed with the handler's `@Serialize(schema)`, which drops anything the contract doesn't declare.
6. **Exception filter**: whatever is thrown becomes `{ error: ErrorBody }`. A unique or foreign-key violation becomes a 409 and an unreachable database a 503, without the service catching anything. Anything else is a 500, logged under the request id.

## Auth

- Login and register set two HttpOnly cookies: a 15-minute access token (a stateless JWT) and a refresh token for the session, which lasts 30 days and slides forward on every refresh. The refresh token is not rotated.
- The guard reads `Authorization: Bearer` first, then the cookie, and never touches the database.
- Every route is admin-only unless it declares `@Roles("user")`, for any logged-in user, or `@Public()`, for anyone. Admins pass every role check.

## Database

- `compose.yaml` runs Postgres 18. `pnpm db:push` syncs the `*.table.ts` files into it; there are no migrations until the first deploy with data worth keeping.
- `pnpm db:seed` adds `admin@example.com`, `ada@example.com` and `alan@example.com`, all with the password `password`.
- The app boots without a reachable database; `/api/health/ready` answers 503 until it is up.

## DTCC Engine

DTCC Engine runs Datasets as jobs. `/api/datasets` lists them, and `/api/jobs` submits, follows and downloads a user's jobs. The browser never calls the engine: its one shared token gives access to every job, so only the backend holds it.

- **Configuration:** `ENGINE_URL` and `ENGINE_API_TOKEN`. Left empty, the backend still boots, warns once, and answers the engine routes with 503; health is unaffected. To run both locally, start `pnpm dev:engine` and set `ENGINE_URL=http://127.0.0.1:8000` and `ENGINE_API_TOKEN=local-dev-engine-token` in `.env`.
- **Failures:** `EngineClient` logs why a call failed and throws `EngineUnavailableError`, a 503 unless the caller catches it. The engine's rejections of a job's parameters become a 400.
- **Jobs update when they are read.** The engine never notifies and lists no jobs, so each job row keeps the engine's id for it, and reading an unfinished job (`GET /api/jobs/:id` or the list) asks the engine first. While the engine is down, a read answers the last stored state.
- **A job is `completed` once its package is stored.** The read that sees the engine finish downloads the package into `PACKAGE_STORAGE_DIR` first (`.data/packages` by default), so a completed job's download never depends on the engine. The engine deletes its copy after 30 days, so a job nobody reads for that long is lost. Will switch to object storage later.

## Tests

- **Unit** (`src/**/*.spec.ts`): next to the code, no database.
- **E2E** (`test/e2e/*.e2e-spec.ts`): Supertest against the real app, built by `createTestApp()` exactly as `main.ts` builds it. Needs Docker.
  - One Postgres container per run. The schema is pushed once into a template database, and each file clones its own copy, so files run in parallel. Tests inside a file share it: call `truncateAllTables()` in `beforeEach`.
  - `authHeader("admin")` signs a token for a user that doesn't exist. The guard never looks users up, so access tests need no rows. When the row matters, create the user through `UsersService` and pass its id: `authHeader("user", { userId })`.
  - `.env` is ignored; `JWT_SECRET` is random per run.
  - DTCC Engine is a stub (`test/helpers/stub-engine.ts`): a local HTTP server answering with the engine's shapes, set by each test. Config is read when `app.module.ts` is imported, so a file starts the stub and sets `ENGINE_URL` before importing `createTestApp` (`jobs.e2e-spec.ts`). Other files run with no engine configured.
  - Vitest clears every mock's calls before each test, so a spy set in `beforeAll` has no calls left by the time a test reads it.

## Commands

From the repo root:

| Command                                                 | Purpose                                        |
| ------------------------------------------------------- | ---------------------------------------------- |
| `pnpm dev:backend`                                      | Backend in watch mode (builds contracts first) |
| `pnpm db:push` / `pnpm db:seed` / `pnpm db:reset`       | Sync tables / seed / recreate and do both      |
| `pnpm --filter backend test:watch`                      | Unit tests in watch mode                       |
| `pnpm test:e2e`                                         | All e2e tests                                  |
| `pnpm --filter backend test:e2e users`                  | E2E files whose name matches `users`           |
| `pnpm --filter backend exec vitest --project e2e users` | The same, in watch mode                        |

# Backend

NestJS 12 on Express, serving everything under `/api`, with Drizzle over a `pg` pool.

API reference: Swagger UI at <http://localhost:3030/api/docs> outside production.

## Layout

```
src/
  main.ts, app.setup.ts   bootstrap; configureApp() is shared with the e2e tests
  migrate.ts              applies drizzle/ to DATABASE_URL; deploys run it before main.ts
  app.module.ts           every module is imported here
  config/                 env schema, validated once at boot
  common/                 decorators, error handling, request id
  infra/database/         pool, shared columns, relations.ts
  infra/engine/           EngineClient: the only code that calls DTCC Engine
  infra/gateway/          GatewayClient: the only code that calls APISIX's Admin API
  infra/storage/          PackageStorage: the packages of completed jobs
  infra/valkey/           ValkeyModule: the Valkey client
  docs/                   OpenAPI document and Swagger UI
  modules/<name>/         controller → service → repository, plus table and module
drizzle/                  migrations, from `pnpm db:generate`
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

## Accounts

- `users` is the user record, which other modules read; it has no routes. `accounts` holds every route on a user: `AccountsController` for the caller (`PATCH /users/me`) and `AccountsAdminController` for admins (`/admin/users`). `AccountsService` is the only place a user's status, tier or existence changes.
- Each user has a status, `pending`, `active` or `disabled`, and a tier, `default` or `elevated`. Signing up makes a `pending` user, logged in at once; a user an admin creates starts `active`. Only `active` users can submit jobs or create API keys. A deploy's `node dist/migrate.js` creates the first admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` while there is no active admin. Tiers are not used yet: the frontend neither shows nor sets them, so every user it makes stays on `default`.
- Admins change them with `PUT /admin/users/:id/status` (approve, reject, disable, enable; nothing goes back to `pending`) and `PUT /admin/users/:id/tier`. The tier survives disable and enable. `PATCH /admin/users/:id` edits only name and email.
- Disabling revokes the user's API keys and ends their sessions, and login answers 403 `ACCOUNT_DISABLED` once the password matches. An access token already issued keeps working until it expires, up to 15 minutes. Enabling again restores no keys.
- Admins can't change their own status or delete themselves, and the last active admin can't be disabled or deleted.

## Database

- `compose.yaml` runs Postgres 18. `pnpm db:push` syncs the `*.table.ts` files into it.
- Deploys apply the migrations in `drizzle/` with `node dist/migrate.js`, before the backend starts. `pnpm db:generate` writes the migration for a table change; `test/e2e/migrations.e2e-spec.ts` fails while one is missing, since it migrates an empty database and expects push to find nothing left to do. A generated migration is reviewed like code: a rename can come out as a drop and an add.
- `pnpm db:seed` adds the active `admin@example.com`, `ada@example.com` (elevated tier) and `alan@example.com`, the pending `katherine@example.com` and the disabled `charles@example.com`, all with the password `password`.
- The app boots without a reachable database or Valkey; `/api/health/ready` answers 503 until both are up.

## Valkey

- `compose.yaml` runs Valkey 9, which `VALKEY_URL` in `.env.example` points at. `ValkeyModule` provides the client, `Valkey` from `iovalkey`: import the module and inject it with `@InjectValkey() valkey: Valkey`.
- It holds short-lived state that may be lost, such as the hourly job counts: there is no volume, so a new container starts empty.
- Without it, the app still boots and reconnects on its own, but isn't ready (503 `Valkey unavailable`). A command fails at once while Valkey is unreachable, and one in flight when the connection drops fails too, rather than be resent after the reconnect.

## DTCC Engine

DTCC Engine runs Datasets as jobs. `/api/datasets` lists them without a login, and `/api/jobs` submits, follows and downloads a user's jobs. The browser never calls the engine: its one shared token gives access to every job, so only the backend holds it.

- **Configuration:** `ENGINE_URL` and `ENGINE_API_TOKEN`. Left empty, the backend still boots, warns once, and answers the engine routes with 503; health is unaffected. To run both locally, start `pnpm dev:engine` and set `ENGINE_URL=http://127.0.0.1:8000` and `ENGINE_API_TOKEN=local-dev-engine-token` in `.env`.
- **Failures:** `EngineClient` logs why a call failed and throws `EngineUnavailableError`, a 503 unless the caller catches it. The engine's rejections of a job's parameters become a 400.
- **Hourly limit:** each user can submit `JOB_LIMIT_PER_HOUR` jobs (10 by default) per clock hour of the backend's clock, admins included. Past it, `POST /api/jobs` answers 429 `TOO_MANY_REQUESTS` with the minutes until the next hour, and nothing reaches the engine. Every job the engine accepted counts, including one whose queuing it couldn't confirm; a submission refused before or by the engine, or that never reached it, doesn't. `JobLimit` keeps the counts in Valkey (`job-limit:<userId>:<hour>`), so without Valkey submissions answer 503.
- **Jobs update when they are read.** The engine never notifies and lists no jobs, so each job row keeps the engine's id for it, and reading an unfinished job (`GET /api/jobs/:id` or the list) asks the engine first. While the engine is down, a read answers the last stored state.
- **A job is `completed` once its package is stored.** The read that sees the engine finish downloads the package into `PACKAGE_STORAGE_DIR` first (`.data/packages` by default), so a completed job's download never depends on the engine. The engine deletes its copy after 30 days, so a job nobody reads for that long is lost. Will switch to object storage later.

## Tests

- **Unit** (`src/**/*.spec.ts`): next to the code, no database.
- **E2E** (`test/e2e/*.e2e-spec.ts`): Supertest against the real app, built by `createTestApp()` exactly as `main.ts` builds it. Needs Docker.
  - One Valkey container per run, shared by every file, so keys must carry something unique to the test, such as a user id. The client connects in the background and fails commands until it has, so a file whose first command needs Valkey calls `waitForValkey(app)` after `createTestApp()`.
  - One Postgres container per run. The schema is pushed once into a template database, and each file clones its own copy, so files run in parallel. Tests inside a file share it: call `truncateAllTables()` in `beforeEach`.
  - `authHeader("admin")` signs a token for a user that doesn't exist. The guard never looks users up, so access tests need no rows. When the row matters, create the user through `UsersService` and pass its id: `authHeader("user", { userId })`.
  - `.env` is ignored; `JWT_SECRET` is random per run.
  - DTCC Engine is a stub (`test/helpers/stub-engine.ts`): a local HTTP server answering with the engine's shapes, set by each test. Config is read when `app.module.ts` is imported, so a file starts the stub and sets `ENGINE_URL` before importing `createTestApp` (`jobs.e2e-spec.ts`). Other files run with no engine configured.
  - APISIX's Admin API is a stub too (`test/helpers/stub-gateway.ts`), set up the same way (`keys.e2e-spec.ts`). Without it, the backend runs with no gateway, as other files do.
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

## Area chat

The `agent` module serves user-owned chats under `/api/agent/chats`. Asking a question streams validated SSE events; the `city` tool submits jobs through `JobsService`, reads canonical packages and reports their building counts. Jobs still running after `AGENT_JOB_WAIT_MS` (45 s by default) are reported by the module's watcher, without another question. A chat's jobs count toward the user's `JOB_LIMIT_PER_HOUR`; past it, the tool tells the model the limit and when it resets. A package is read from its stored file, once per report and one at a time per process: only the manifest and the model are inflated, and only the model's object kinds are kept after decoding. The frontend polls chats while they wait for a job or an answer.

`AGENT_MODEL_PROVIDER` selects `scripted` (the default), `bedrock`, or `anthropic`. Bedrock uses `AWS_BEARER_TOKEN_BEDROCK`, `AGENT_BEDROCK_REGION` (default `eu-north-1`) and the EU profile `eu.anthropic.claude-sonnet-5-5`. Anthropic requires `ANTHROPIC_API_KEY`; its processing does not stay in the EU. `AGENT_MODEL` overrides the provider's model id; a model without rates in `model.cost.ts` has its turns stored without a cost, with one warning per model. Keep credentials in `.env` or deployment secrets.

`AGENT_DATASETS` is a comma-separated allowlist, initially `city`. Defaults are 5 km² per area, 512 MiB per decoded model and 100 message turns per user in 24 hours. Admission reserves a running turn and claims the chat in one transaction under a per-user advisory lock. Each model call is counted on the turn before it is made, so failed turns count once they reached the model, and those with no model calls do not. A chat lock expires after ten minutes; taking an expired lock marks the turns that held it `failed` with `interrupted`, and a tool call left without its result is closed with an error result before the chat's next turn. Once admitted, a failure ends the stream with an `error` event. Deleting a chat preserves its jobs in Downloads and its turn accounting.

The watcher runs every `AGENT_RESUME_INTERVAL_SECONDS` (default 5); 0 disables it. It skips the chats of users who are not active, whose jobs keep waiting. E2E tests disable it and call `AgentService.resumeFinished()` directly. Model turns stop after six calls or 110 seconds. Disconnecting cancels the model request; started Engine jobs continue.

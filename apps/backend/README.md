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
  common/                 decorators, error handling, request id, background timers
  infra/database/         pool, shared columns, relations.ts
  infra/engine/           EngineClient: the only code that calls DTCC Engine
  infra/gateway/          GatewayClient: the only code that calls APISIX's Admin API
  infra/model/            ModelClient: the only code that calls the chat model (ScriptedModel for now)
  infra/storage/          PackageStorage: the packages of completed jobs
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
- The app boots without a reachable database; `/api/health/ready` answers 503 until it is up.

## DTCC Engine

DTCC Engine runs Datasets as jobs. `/api/datasets` lists them without a login, and `/api/jobs` submits, follows and downloads a user's jobs. The browser never calls the engine: its one shared token gives access to every job, so only the backend holds it.

- **Configuration:** `ENGINE_URL` and `ENGINE_API_TOKEN`. Left empty, the backend still boots, warns once, and answers the engine routes with 503; health is unaffected. To run both locally, start `pnpm dev:engine` and set `ENGINE_URL=http://127.0.0.1:8000` and `ENGINE_API_TOKEN=local-dev-engine-token` in `.env`.
- **Failures:** `EngineClient` logs why a call failed and throws `EngineUnavailableError`, a 503 unless the caller catches it. The engine's rejections of a job's parameters become a 400.
- **Jobs update in the background.** The engine never notifies and lists no jobs, so each job row keeps the engine's id for it, and `JobsWatcher` asks the engine about every unfinished job every `JOBS_REFRESH_INTERVAL_SECONDS` (10 by default). A refresh writes only what changed. Reads (`GET /api/jobs/:id` and the list) answer the stored state and never call the engine, so a job's state is at most one interval old. While the engine is down, the stored state stays as it was.
- **A job is `completed` once its package is stored.** The refresh that sees the engine finish downloads the package into `PACKAGE_STORAGE_DIR` first (`.data/packages` by default), so a completed job's download never depends on the engine. The engine deletes its copy after 30 days, so a package that can't be downloaded for that long is lost. Will switch to object storage later.
- **A completed job's result is its manifest.** `GET /api/jobs/:id/result` answers the `manifest.json` that Core writes into every package: what was produced, from which request, with its headline, summary and warnings. It is read out of the stored package without unpacking the rest, and passed on whole, since what it holds is Core's to define.

## Chats

`/api/chats` holds a user's conversations with the assistant: the stored messages, and a lock for the turn that answers them.

- **A turn runs within the request.** `POST /api/chats` starts a chat with its first message and `POST /api/chats/:id/messages` continues one. Each stores the user's message, runs the model, stores its answer and responds with the whole chat, so a turn must stay well under the web server's 120 seconds.
- **One turn at a time.** A turn claims its chat (`chats.turn_started_at`) and releases it however it ends, and the chat's `answering` says a claim is held. A message sent meanwhile answers 409. A claim older than 10 minutes belongs to a process that died, so the next message takes the chat over.
- **Stored as the model saw it.** A message's `content` is exactly what the model was sent or answered, thinking blocks included, and every later turn replays it unchanged: the prompt cache and the thinking blocks depend on it, so earlier messages are never edited. `data` holds what the transcript shows (`entries`). The app's own blocks in a user message are tagged, such as `<map_context>` with the area selected on the map, so the model can tell them from the user's words.
- **Datasets are the tools.** The model gets a `run_<dataset>` tool for each Dataset in DTCC Engine's catalog, narrowed by `CHAT_DATASETS`, with Core's description and parameters minus `bounds` and `format`, plus `get_job`. The app passes the area selected with the latest message as the bounds, and without one the tool starts nothing. A call submits an ordinary job as the chat's owner, so it is in their Downloads and counts against them, and `chat_jobs` links it to the chat. A turn makes at most 6 model requests.
- **A tool waits briefly for its job**, up to `CHAT_JOB_WAIT_MS` (20 seconds by default). A job that ends in time is answered in the same turn; a longer one comes back as still running, and the chat counts it in `waitingJobs` until the model has been told how it ended.
- **A job that outlives its turn is reported in the chat.** `ChatsWatcher` runs `ChatsService.resumeFinished()` every `CHAT_RESUME_INTERVAL_SECONDS` (5 by default). For each chat with a job that has ended since, it claims the chat, stores one `job_update` message telling the model how those jobs ended, marking them reported with it, and runs a turn to answer it. A chat whose turn is held waits for the next run. The update is stored before the turn runs, so a model that can't answer leaves it in the chat as a card, and the next turn still reads it. Job states come from the database, so a result is posted within both watchers' intervals of its job ending.
- **A user's message hears about ended jobs first.** Its turn stores the update for any job that ended since the last turn before the user's words, so the model reads them knowing it.
- **A job's result is its manifest** (see `GET /api/jobs/:id/result`), passed to the model whole up to 64 KB.
- **A failed tool call is a result**, not an error: a rejected parameter, an engine that can't take the job, or no selected area each comes back for the model to explain, and the turn goes on.
- **A failed turn keeps the message.** When the model fails or refuses, the turn stores a notice instead of an answer. Notices are shown, never sent to the model, and the next message carries on.
- **Every turn is recorded** in `chat_turns`, with its outcome and tokens. The records stay when their chat is deleted.
- **Only active accounts chat**, since every turn costs model tokens.
- **The model** is `ModelClient` (`infra/model/`), one Messages API request per call in the Anthropic SDK's types. `ScriptedModel` stands in until the Bedrock adapter exists: it answers from a fixed script after `SCRIPTED_MODEL_DELAY_MS` (800 by default), and `[fail]` or `[refuse]` in a message makes it fail or refuse. The system prompt is in `modules/chats/system-prompt.ts`.

## Tests

- **Unit** (`src/**/*.spec.ts`): next to the code, no database.
- **E2E** (`test/e2e/*.e2e-spec.ts`): Supertest against the real app, built by `createTestApp()` exactly as `main.ts` builds it. Needs Docker.
  - One Postgres container per run. The schema is pushed once into a template database, and each file clones its own copy, so files run in parallel. Tests inside a file share it: call `truncateAllTables()` in `beforeEach`.
  - `authHeader("admin")` signs a token for a user that doesn't exist. The guard never looks users up, so access tests need no rows. When the row matters, create the user through `UsersService` and pass its id: `authHeader("user", { userId })`.
  - `.env` is ignored; `JWT_SECRET` is random per run.
  - DTCC Engine is a stub (`test/helpers/stub-engine.ts`): a local HTTP server answering with the engine's shapes, set by each test. Config is read when `app.module.ts` is imported, so a file starts the stub and sets `ENGINE_URL` before importing `createTestApp` (`jobs.e2e-spec.ts`). Other files run with no engine configured.
  - Background work is off (`test/setup-env.ts`), so no run lands between a test's steps; a test runs it by calling the service, such as `JobsService.refreshActive()`. `jobs-watcher.e2e-spec.ts` and `chats-watcher.e2e-spec.ts` check the timers themselves.
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

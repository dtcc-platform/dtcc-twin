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

## Tests

- **Unit** (`src/**/*.spec.ts`): next to the code, no database.
- **E2E** (`test/e2e/*.e2e-spec.ts`): Supertest against the real app, built by `createTestApp()` exactly as `main.ts` builds it. Needs Docker.
  - One Postgres container per run. The schema is pushed once into a template database, and each file clones its own copy, so files run in parallel. Tests inside a file share it: call `truncateAllTables()` in `beforeEach`.
  - `authHeader("admin")` signs a token for a user that doesn't exist. The guard never looks users up, so access tests need no rows. When the row matters, create the user through `UsersService` and pass its id: `authHeader("user", { userId })`.
  - `.env` is ignored; `JWT_SECRET` is random per run.

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

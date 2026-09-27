# Backend conventions

## Rules

### Modules

- A module is `src/modules/<name>/` with `.controller.ts`, `.service.ts`, `.repository.ts`, `.table.ts` and `.module.ts` by default, can also include other files as needed. Only repositories touch the database.
- Other modules use a module's exported service, never its repository (`UsersModule` exports `UsersService`).

### Routes

- Every handler declares `@Serialize(schema)` for its response, or `@HttpCode(HttpStatus.NO_CONTENT)` and no body. Every `@Body`, `@Query` and `@Param` takes `{ schema }` from `@repo/contracts`. `test/e2e/contract-coverage.e2e-spec.ts` enforces both.
- Routes about the caller use `me` or no id at all (`PATCH /users/me`, `/settings`) and take the user from `@CurrentUser()`, never from the URL. Declare static segments such as `me` before `:id`.

### Data

- Tables use `snakeCase.table`, ``id: uuid().primaryKey().default(sql`uuidv7()`)`` and `...timestamps`. Foreign keys state their `onDelete` and get an index.
- Every table is listed in `src/infra/database/relations.ts`, even one without relations.
- Repositories return contract types, not rows: map each row and turn dates into ISO strings. Secrets such as `passwordHash` leave the repository only through a method made for them.
- Queries on user-owned rows filter by the owner, so another user's row is simply not found (see `items.repository.ts`).
- An empty PATCH changes nothing and answers the current record; Drizzle rejects an empty `SET`, so repositories return early.
- Stored timestamps are written and compared with the database clock (``sql`now()` ``), not `new Date()`.
- No TypeScript `enum` (lint): use a zod enum from contracts.

### Errors

- Don't catch database errors; the exception filter already maps them to 409 and 503.
- Throw Nest's HTTP exceptions (`NotFoundException`, …). Add `withErrorCode()` only when a client must tell apart two failures with the same status; the code goes in the contracts' `errorCodeSchema` first.

### Config

- Read configuration through `ConfigService` only; lint forbids `process.env` outside `src/config/`. Constructors inject `ConfigService<Env, true>`; elsewhere annotate with `EnvConfigService`.

### Tests

- Each route covers its success path, validation failure, access (401/403) and not found where it applies.

## Recipes

### Add a module

1. Write its contracts ([contracts recipe](../../packages/contracts/CONVENTIONS.md#recipe-contracts-for-a-new-module)).
2. Write `test/e2e/<name>.e2e-spec.ts` for the first route and watch it fail. `items.e2e-spec.ts` shows the setup, including two users for ownership checks.
3. Add `<name>.table.ts`, list it in `relations.ts`, and run `pnpm db:push`.
4. Add the repository, service and controller. `items` shows a user-owned resource; `users` shows admin CRUD.
5. Add `<name>.module.ts` and import it in `app.module.ts`.
6. Repeat 2 and 4 route by route. Seed a few rows in `scripts/seed-data.ts` if they help development.

### Add a column

1. Add it to the table and run `pnpm db:push`.
2. Add it to the contract, then to the repository's row mapping.

### Add an environment variable

1. Declare it in `src/config/env.schema.ts` and add the same line to `.env.example`.
2. Read it with `config.get("NAME", { infer: true })`.

### Change who can call a route

1. Add `@Roles(…)` or `@Public()` to the handler, or to the controller for all of its routes.
2. Cover the new access rule in the module's e2e spec.

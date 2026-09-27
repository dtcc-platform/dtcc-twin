# Contracts conventions

## Rules

- One folder per API module (`src/users/users.ts`). Each schema sits next to its inferred type: `userSchema`, `type User`.
- **Response schemas** use `z.object`. Unknown keys are stripped, so the schema is also the allowlist of what leaves the API: a `passwordHash` on the row never reaches the wire. Input rules (trimming, lengths) stay off them.
- **Request bodies** use `z.strictObject`: an unknown key, such as a typo like `nmae`, is a 400 instead of being dropped. Update bodies make every field optional.
- No transform (`trim`, `toLowerCase`) on a format schema such as `z.email()`: it hides the format from the OpenAPI document.
- Timestamps are `z.iso.datetime()` strings.
- Lists respond with `offsetPage(itemSchema)` and take `offsetPaginationQuerySchema`; single-resource routes take `idParamsSchema`.
- `src/index.ts` is the public API and exports name by name. Field rules shared between contracts (`emailSchema`, `passwordSchema`) are imported file to file and stay out of it.
- `ErrorCode` grows only when a client must tell apart two failures with the same status.
- Rules that could regress (trimming, stripping, limits) get a test in a `*.spec.ts` next to the file.

## Recipe: contracts for a new module

1. Create `src/<module>/<module>.ts` with the response schema, `offsetPage(…)` if the resource is listed, and the create and update body schemas. [`src/items/items.ts`](src/items/items.ts) is a compact example.
2. Export the schemas and types from `src/index.ts`.
3. Pin the rules worth pinning in `src/<module>/<module>.spec.ts`.
4. Use them in the backend and the frontend.

# @repo/contracts

Zod schemas, and the types inferred from them, for every request and response of the API. The backend validates and serializes with them; the frontend types its API calls and forms with them. A contract change is a compile error wherever it breaks something, on both sides.

## How the apps load it

| Consumer                                       | Reads                                               |
| ---------------------------------------------- | --------------------------------------------------- |
| Typechecking in both apps, Vite, Vitest        | `src/`, through the `@repo/source` export condition |
| The running backend (`pnpm dev`, `start:prod`) | `dist/`, the compiled build                         |

`pnpm dev` builds this package first and keeps `tsc --watch` running. A change to a type restarts the backend on its own; a runtime-only change (a limit, a default, a regex) reaches it after the next backend file save or `pnpm dev` restart.

**Stale `dist`:** types and tests agree with your change, but the running backend still behaves the old way (it rejects a value you just allowed, say). Rebuild with `pnpm --filter @repo/contracts build`.

## Commands

| Command                               | Purpose                   |
| ------------------------------------- | ------------------------- |
| `pnpm --filter @repo/contracts test`  | Schema unit tests         |
| `pnpm --filter @repo/contracts build` | Compile `src/` to `dist/` |

How to write a contract: [CONVENTIONS.md](CONVENTIONS.md).

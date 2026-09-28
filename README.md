# DTCC Twin

DTCC Twin provides the user-facing interface to DTCC Platform. It enables users to explore and interact with digital twin data on the web, through projection onto physical 3D-printed city models, and through other digital and physical experiences.

This project is part of the [Digital Twin Platform (DTCC Platform)](https://github.com/dtcc-platform/) developed at the [Digital Twin Cities Centre](https://dtcc.chalmers.se/) supported by Sweden’s Innovation Agency Vinnova under Grant No. 2019-421 00041.

## Authors (in order of appearance)

- [Vasilis Naserentin](https://www.chalmers.se/en/Staff/Pages/vasnas.aspx)
- [Anders Logg](http://anders.logg.org)

## Packages

TypeScript / ESM monorepo managed with pnpm workspaces, plus the Python engine.

| Package                                              | What it is                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| [`apps/frontend`](apps/frontend/README.md)           | The web app: React SPA with TanStack Router                       |
| [`apps/backend`](apps/backend/README.md)             | NestJS API under `/api`                                           |
| [`apps/engine`](apps/engine/AGENTS.md)               | DTCC Engine, a Python API over DTCC Core and Sim; not yet started |
| [`packages/contracts`](packages/contracts/README.md) | Zod schemas and types shared by the backend and the frontend      |

Table, the experience projected onto physical city models, will be `apps/table`.

Each TypeScript package has a `README.md` on how it works and a `CONVENTIONS.md` with its rules and step-by-step recipes.

## Start

Requires Node ^24.20.0, pnpm 10 or newer, and Docker.

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env # first run only
docker compose up -d --wait                    # Postgres
pnpm db:push && pnpm db:seed                   # tables and sample users
pnpm dev
```

- Frontend: <http://localhost:3000>, proxying `/api` to the backend. Log in as `admin@example.com` with password `password`.
- Backend: <http://localhost:3030/api>, Swagger UI at <http://localhost:3030/api/docs>.

## Commands

From the repo root:

| Command                                      | Purpose                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`                                   | The backend and the frontend in watch mode                                       |
| `pnpm check`                                 | Everything CI runs: format, lint, typecheck, unit, e2e, build. Needs Docker      |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | The fast subset while iterating                                                  |
| `pnpm test:e2e`                              | Backend e2e tests                                                                |
| `pnpm format`                                | Format the repo with Prettier                                                    |
| `pnpm db:push`                               | Sync the backend tables into `DATABASE_URL`                                      |
| `pnpm db:seed`                               | Add the sample users; asks before wiping a non-empty database                    |
| `pnpm db:reset`                              | Recreate the compose database, push and seed                                     |
| `pnpm build`                                 | Build the contracts, the backend and the frontend into their `dist/` directories |

The package READMEs list their own, such as running one e2e file.

## Contracts during development

The backend and the frontend typecheck against the contracts' source, but the running backend loads their compiled `dist/`. `pnpm dev` keeps it rebuilt; if the backend ignores a contract change that types and tests already see, see [stale `dist`](packages/contracts/README.md#how-the-apps-load-it).

## Repo tooling

- **Git hooks** (Lefthook, installed by `pnpm install`): pre-commit checks formatting and lint on staged files; pre-push runs typecheck and unit tests.
- **CI** (GitHub Actions): a frozen install and `pnpm check` on pull requests and pushes to `main`.
- **Dependencies:** shared versions and install policy live in `pnpm-workspace.yaml`: strict Node and peer checks, and a seven-day delay before a new release can be installed.
- **Editor:** VS Code formats with Prettier on save and runs ESLint per package; the recommended extensions are listed.

## License

This project is licensed under the [MIT license](https://opensource.org/licenses/MIT).

Copyrights are held by the individual authors as listed at the top of each source file.

## Community guidelines

Comments, contributions, and questions are welcome. Please engage with us through Issues, Pull Requests, and Discussions on our GitHub page.

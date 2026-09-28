# Conventions

Repo-wide rules. Each package's own are in its `CONVENTIONS.md`: [backend](apps/backend/CONVENTIONS.md), [frontend](apps/frontend/CONVENTIONS.md), [contracts](packages/contracts/CONVENTIONS.md). The engine's are in [apps/engine/AGENTS.md](apps/engine/AGENTS.md).

## Rules

### Code

- Readability first.
- Check nontrivial choices against the framework's official documentation.
- `type` by default; `interface` only where declaration merging or augmentation is the point.
- Follow the existing pattern, and write new code so its pattern is easy to spot and copy.

### Comments

- No comment by default. A comment earns its place by telling a reader something the code can't: what a thing is for when its name can't say it, a trap (code that looks wrong or replaceable but isn't), a hidden constraint (security, data, an outside system), or a workaround for surprising library behavior.
- One line, rarely two. Never restate the code, explain standard practice, cite a standard in prose, or record history and measurements; those belong in the commit message.
- A rule that applies in many places goes in a `CONVENTIONS.md`, not at every site.
- `/** */` on exports whose hover text helps callers; `//` for everything else.
- Tests may say more, to explain setup and intent.

### Tests

- Tests are written before implementation and cover main flows and important edge cases. They are the spec's executable check: implementation changes to satisfy them, not the other way around.
- Backend: strict. Every behavior change starts with a failing test.
- Frontend apps: proportionate to risk. Test first for forms with validation, permission-gated UI, and flows that change or delete data; layout and pure presentation don't need it.
- Changing an existing test's expectations requires an explicit reason.
- `pnpm check` passes before a change goes to review.

### Tooling

- Lint reports and never fixes: no fix-on-save, no `--fix` in hooks or scripts. Prettier formats.
- Dev tools are open source, run offline, and are pinned to a version.

### Docs

- A change to a rule or a recipe step updates that `CONVENTIONS.md` in the same change; a change to how something works updates its `README.md`.

### Commits

- **Commit messages:** `Type: Subject`, with a capitalized type and a sentence-case subject, for example `Fix: Reuse Core data validation`.
- **No AI attribution:** no AI-generated attribution, AI co-author trailers or agent session links in commit messages or pull requests.

# Agent phase 1 Implementation Plan

> **For agentic workers:** work task by task, in order; steps use checkbox (`- [ ]`) syntax for tracking. Each task's tests come first and must fail for the missing behaviour before you implement.

**Goal:** A chat panel in Twin where a signed-in user asks about the area they drew, and the backend answers with a model through Engine jobs: in the same turn when the job is quick, in the chat when it ends otherwise.

**Architecture:** A new backend module `agent` runs a turn per question inside one SSE response: the model, generic `run_<dataset>` tools that start Engine jobs through `JobsService`, a reader per Dataset that turns a package into facts (`city`: building count from the protobuf model). A watcher in the module reports jobs that end after their turn. Chats are locked one turn at a time. The model is reached through our own `ModelClient` with Bedrock, Anthropic API and scripted adapters. A frontend feature `agent` adds a right-hand workspace panel with chat history.

**Tech Stack:** NestJS, Drizzle/Postgres, zod contracts (`@repo/contracts`), vitest, `@anthropic-ai/bedrock-sdk`, `@anthropic-ai/sdk`, `protobufjs`, `yauzl`, `proj4`; React, TanStack Query, MapLibre (`react-map-gl/maplibre`).

**Spec:** [`docs/agent-migration/phase-1-design.md`](phase-1-design.md). Read it first, including "What changed on 2026-11-07".

## Execution

- The implementation runs in a separate thread with Codex, in the existing worktree `dtcc-twin-agent-migration` (branch `plan/agent-migration`, at `develop` `0312f82`, holding these docs); agents may not create worktrees. When it is done, the result is reviewed, verified and tested in the planning thread before it goes to Spiros and Napo.
- **Git is read-only** (dtcc-twin `AGENTS.md`): no staging, committing, branching or stashing. Each task ends by listing its changed files; Spiros reviews and commits.
- **Red tests fail on behaviour.** When a test imports code that does not exist yet, first add the export as a stub with the final signature (a schema that rejects everything, such as `z.never()`; a function or method that throws `new Error("Not implemented")`; an empty class), so the test compiles and fails on its assertions. "Expected: FAIL" below always means that kind of failure, never a missing module or a type error (`AGENTS.md`).
- Follow `AGENTS.md`, `CONVENTIONS.md`, `apps/backend/CONVENTIONS.md`, `apps/frontend/CONVENTIONS.md` and `packages/contracts/CONVENTIONS.md`. Tests first; implement from the spec, not from the tests; never weaken a test to get to green; stop and ask if a test looks wrong. Notes only for the reviewer start with `// REVIEW:`.
- No AI attribution anywhere (commit messages, pull requests, code).
- Napo's `ai-integration` branch is a reference for patterns only (listed under each task where it helps). Do not copy files from it.

## Global Constraints

- Base: dtcc-twin `develop` `0312f82`. The jobs module is not changed.
- Model: through `ModelClient` only (`src/infra/model/`). Providers `bedrock` (`eu-north-1`, `AWS_BEARER_TOKEN_BEDROCK`, model `eu.anthropic.claude-sonnet-5-5`; used for development and the demo), `anthropic` (`claude-sonnet-5-5`, `ANTHROPIC_API_KEY`; optional), `scripted` (tests). Keys are never logged or committed. A working Bedrock key is in `apps/backend/.env` of this worktree.
- Sonnet 5.5 rules: `tool_choice` only `auto` (forced choice is a 400); thinking stays on (adaptive), so `max_tokens: 4096` and `output_config: { effort: "low" }`; the model history is append-only and assistant `content` is stored and replayed unchanged, thinking blocks included; check `stop_reason` `refusal` and `max_tokens` before reading content. On the Anthropic API, the refusal fallback is on (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`).
- Limits (all from configuration): area at most `AGENT_MAX_AREA_KM2` = 5; area optional; `AGENT_QUESTIONS_PER_DAY` = 100 per user, counting `message` turns only; one turn per chat, lock free when `turn_started_at` is null or older than 10 minutes; at most 6 model calls per turn; 110 s per turn; a tool waits `AGENT_JOB_WAIT_MS` = 45000 for its job, reading it every 2 s; reuse a job of the same user, Dataset and parameters from the last 24 h that has not failed; model at most `AGENT_MAX_MODEL_MB` = 512 uncompressed; one package read at a time per process. Enabled Datasets: `AGENT_DATASETS` = `city`.
- No tool takes coordinates; tools use the bounds stored with the chat's latest user message.
- Package reader: the protobuf schema is `dtcc.proto` at Core `17c6efe`, copied verbatim.
- Fixtures: `~/.gstack/tmp/phase1-fixtures/city-small.dtccpkg` (bounds `[319499, 6397999, 319686, 6398175]`, 21 buildings by Core's loader and by a raw protobuf count) and `~/.gstack/tmp/phase1-fixtures/dtcc.proto`. Larger packages measured on 2026-11-07 are in `~/.gstack/tmp/phase1-fixtures/sizing/` (2 km²: 1,208 buildings; 5 km²: 3,296); they are too large for the repository and are only for a manual check.

## Review Focus

1. A client that disconnects while a job runs: the turn ends `failed` with `client_disconnected`, the lock is released, the job is reported later by the watcher, and the user can ask again at once. (Tasks 9, 10)
2. Two tabs sending to one chat at the same instant: exactly one runs, the other gets `409 AGENT_CHAT_BUSY`. A crashed turn's lock frees itself after 10 minutes. (Tasks 4, 9)
3. Reopening a chat whose history holds thinking, tool and job-update blocks: the next request sends that history byte-identical to what was stored. (Task 8)
4. A job that ends after its turn: exactly one job update and one turn, even with two watcher runs or two backend processes; a locked chat is left for the next run. (Task 10)
5. A package that is not a zip, lacks `artifacts/model.dtcc`, or is over the size limit: the reader throws `PackageReadError`, nothing is counted, and the job's report says the result could not be read. (Tasks 5, 7)

---

### Task 1: Model provider smoke check (gate)

**Files:** none in the repository; a scratch script outside it. Never print the key.

Already known (2026-11-07, with curl): `eu.anthropic.claude-sonnet-5-5` in `eu-north-1` answers through InvokeModel with the Messages body, adaptive thinking, `output_config: {effort: "low"}`, `tool_choice: {type: "auto"}` and a tool; the bare `anthropic.claude-sonnet-5-5` is refused on demand.

- [x] **Step 1:** In a scratch folder outside the repository, `npm i @anthropic-ai/bedrock-sdk`, read `AWS_BEARER_TOKEN_BEDROCK` from `apps/backend/.env`, and stream one message with `new AnthropicBedrockMantle({ awsRegion: "eu-north-1" })`, model `eu.anthropic.claude-sonnet-5-5` (then `anthropic.claude-sonnet-5-5`), `max_tokens: 64`, `output_config: {effort: "low"}`, via `client.messages.stream(...).finalMessage()`.
- [x] **Step 2:** If Mantle fails, do the same with `new AnthropicBedrock({ awsRegion: "eu-north-1" })` and `eu.anthropic.claude-sonnet-5-5`. Record which client and model id answered, and whether the stream carried `text` events; Task 6 uses them. Stop and report if neither answers.
- [x] **Step 3 (only if `ANTHROPIC_API_KEY` is set):** stream one message with `new Anthropic()` and `claude-sonnet-5-5`, with `fallbacks: "default"` and `betas: ["server-side-fallback-2026-07-01"]` on `client.beta.messages.stream`. Record whether it is accepted. No key does not block the plan.

### Task 2: Contracts and the streaming response declaration (first pull request, for Napo)

**Files:**

- Create: `packages/contracts/src/agent/agent.ts`, `packages/contracts/src/agent/agent.spec.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/common/error-code.ts`
- Create: `apps/backend/src/common/decorators/stream-response.decorator.ts`
- Modify: `apps/backend/test/helpers/route-contract.ts`, `apps/backend/test/e2e/contract-coverage.e2e-spec.ts`, `apps/backend/CONVENTIONS.md` (Routes rule)

**Interfaces:**

- Produces (contracts):
  - `chatSchema` `{id, title, createdAt, updatedAt}`; `chatPageSchema = offsetPage(chatSchema)`.
  - `chatEntrySchema`, discriminated on `type`: `{type:"user", id, createdAt, text, area: AreaBox | null}`, `{type:"assistant", id, createdAt, text}`, `{type:"job", id, createdAt, jobId, dataset}`, `{type:"job_update", id, createdAt, jobId, dataset, state}`, `{type:"notice", id, createdAt, text}`.
  - `chatDetailSchema` `{...chat, entries: ChatEntry[], jobs: Job[], waitingJobs: int ≥ 0, answering: boolean, area: AreaBox | null}` (`area`: the last user message's).
  - `askBodySchema` strict `{text: string trimmed 1–4000, area: areaBoxSchema.nullable()}`; `updateChatBodySchema` strict `{title?: string trimmed 1–120}`.
  - `agentEventSchema`, discriminated on `type`: `{type:"status", message}`, `{type:"text", delta}`, `{type:"job", jobId, dataset}`, `{type:"done", turnId}`, `{type:"error", code, message}`.
  - Types `Chat`, `ChatPage`, `ChatEntry`, `ChatDetail`, `AskBody`, `UpdateChatBody`, `AgentEvent`. Error codes: `AGENT_AREA_TOO_LARGE`, `AGENT_DAILY_LIMIT`, `AGENT_CHAT_BUSY`, `AGENT_UNAVAILABLE`.
- Produces (backend): `StreamResponse(schema)` method decorator and `STREAM_RESPONSE_KEY`, setting metadata and an OpenAPI `text/event-stream` response.

- [x] **Step 1: Write failing contract tests** in `agent.spec.ts`: `askBodySchema` accepts `area: null`, rejects a missing `area` key, an empty or 4,001-character `text` and an unknown key, and trims `text`; `agentEventSchema` parses each of the five event types and rejects `{type:"text"}` without `delta`; `chatSchema.parse` strips an unknown `userId`; `chatEntrySchema` rejects a `job_update` without `state`.
- [x] **Step 2:** Add `agent.ts` with every export as a stub (each schema `z.never()`, types inferred from them) and export it from `index.ts`. Run `pnpm --filter @repo/contracts test`. Expected: FAIL on the assertions.
- [x] **Step 3:** Implement the schemas and the error codes.
- [x] **Step 4:** Run the contract tests. Expected: PASS.
- [x] **Step 5: Coverage test first:** add to `contract-coverage.e2e-spec.ts` a handler decorated with `@StreamResponse(agentEventSchema)` and assert it is _not_ reported as a violation.
- [x] **Step 6:** Add `StreamResponse` as a stub decorator that sets no metadata. Run `pnpm --filter backend test:e2e contract-coverage`. Expected: FAIL (reported as missing `@Serialize`).
- [x] **Step 7:** Implement the decorator; in `route-contract.ts` treat `Reflect.hasMetadata(STREAM_RESPONSE_KEY, handler)` like a file response; add one Routes rule line in `CONVENTIONS.md`: a handler that answers with server-sent events declares `@StreamResponse(eventSchema)` and validates each event with it before writing.
- [x] **Step 8:** Run the coverage e2e. Expected: PASS. List changed files.

### Task 3: Area helpers and background helper

**Files:** Create `apps/backend/src/modules/agent/area.ts`, `area.spec.ts`; create `apps/backend/src/common/background/every.ts`, `every.spec.ts`; add `proj4` to `apps/backend/package.json`; add to `apps/backend/CONVENTIONS.md` a "Background work" section (the rule in the design's Backend section).

**Interfaces:**

- `type SwerefBounds = [number, number, number, number]`; `areaBounds(area: AreaBox): SwerefBounds`; `areaSquareMetres(area: AreaBox): number`. Same projection string and rounding as `apps/frontend/src/lib/sweref.ts` and `apps/frontend/src/features/area/area.ts:21-41`.
- `every(intervalMs: number, task: () => Promise<void>, logger: Logger): { stop(): Promise<void> }`: runs `task` `intervalMs` after the previous run ended, never overlapping; a failed run is logged and the next goes ahead; the timer does not keep the process alive; `stop()` resolves after a run in progress. (Pattern: `ai-integration` `src/common/background/every.ts`.)

- [x] **Step 1: Write failing tests:** `areaBounds({west: 11.97, south: 57.686, east: 11.98, north: 57.692})` equals `[319370, 6397763, 319996, 6398458]`; `areaBounds({west: 11.972, south: 57.688, east: 11.975, north: 57.6895})` equals `[319499, 6397999, 319686, 6398175]`; `areaSquareMetres` of the first is `435070`. With fake timers: `every` runs after the interval, does not start a run while one is in progress, continues after a rejected run and logs it, and `stop()` waits for the run in progress and starts no more.
- [x] **Step 2:** Run `pnpm --filter backend test area every`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run. Expected: PASS. List changed files.

### Task 4: Tables and repository

**Files:**

- Create: `apps/backend/src/modules/agent/agent.table.ts`, `apps/backend/src/modules/agent/agent.repository.ts`
- Modify: `apps/backend/src/infra/database/relations.ts`
- Generated: a migration from `pnpm db:generate`
- Test: `apps/backend/test/e2e/agent.repository.e2e-spec.ts`

**Interfaces:**

- Tables as in the design: `agentChats` (`user_id` → users cascade, indexed; `title`; `turn_started_at` null), `agentMessages` (`chat_id` → agentChats cascade; `seq`; unique (`chat_id`, `seq`); `kind`; `content` jsonb null; `data` jsonb null), `agentChatJobs` (`chat_id` → agentChats cascade; `job_id` → jobs cascade; `dataset`; `parameters` jsonb; `reported` boolean default false; unique (`chat_id`, `job_id`); partial index on `chat_id` where not `reported`), `agentTurns` (`chat_id` → agentChats set null; `user_id` → users cascade; index (`user_id`, `created_at`); `trigger`; `outcome`; `provider`; `model`; `prompt_version`; token columns; `cost_usd` numeric; `model_calls`; `job_ids` uuid[]; `duration_ms`; `error_code` null). All with `uuidv7()` ids and `...timestamps`; timestamps written with `now()`.
- `AgentRepository` (every method on chats filters by `userId`):
  - `createChat(userId, title): Promise<Chat>`; `listChats(userId, limit, offset): Promise<ChatPage>`; `findChat(userId, id): Promise<StoredChat | null>` (`StoredChat` adds `answering`); `renameChat(userId, id, body): Promise<Chat | null>`; `deleteChat(userId, id): Promise<boolean>`.
  - `claimTurn(userId, chatId): Promise<"claimed" | "busy" | "missing">`: one `UPDATE … SET turn_started_at = now() WHERE owner AND (turn_started_at IS NULL OR turn_started_at < now() - interval '10 minutes')`; `releaseTurn(chatId)`.
  - `appendMessages(chatId, messages: NewAgentMessage[], reportedJobIds?: string[])`: in one transaction, assigns the next `seq` values, inserts, marks those chat jobs reported, and touches the chat's `updated_at`.
  - `listMessages(chatId): Promise<AgentMessage[]>` in `seq` order.
  - `linkJob(chatId, jobId, dataset, parameters)`; `listChatJobs(chatId)`; `listUnreportedJobIds(chatId)`; `findChatsWaiting(): Promise<{id, userId}[]>`; `findReusableJob(userId, dataset, parameters): Promise<string | null>` (same user through the chat, same dataset, deep-equal parameters, newer than 24 h, newest first; the caller drops failed ones).
  - `insertTurn(record)`; `countMessageTurnsSince(userId, hours: number)`.

- [x] **Step 1: Write failing e2e tests** against the test database (two users, as `items.e2e-spec.ts` does): another user's chat is `null` from `findChat`, `false` from `deleteChat` and `"missing"` from `claimTurn`; a second `claimTurn` is `"busy"`; after setting `turn_started_at` 11 minutes back it is `"claimed"`; `releaseTurn` frees it; `appendMessages` from two concurrent calls yields distinct `seq` values; `listMessages` returns stored `content` deep-equal and in order; `appendMessages` with reported ids removes the chat from `findChatsWaiting`; `findReusableJob` ignores another user's job, a job older than 24 h, another dataset and different parameters; `countMessageTurnsSince` ignores `job_update` turns; deleting a chat keeps its turns with `chat_id` null.
- [x] **Step 2:** Run `pnpm --filter backend test:e2e agent.repository`. Expected: FAIL.
- [x] **Step 3:** Implement the tables (list them in `relations.ts`), run `pnpm db:push`, implement the repository, run `pnpm db:generate`.
- [x] **Step 4:** Run the e2e tests. Expected: PASS. List changed files.

### Task 5: Package reader

**Files:**

- Create: `apps/backend/src/modules/agent/readers/dtcc.proto` (copy of the fixture's, with a first-line comment naming Core `17c6efe` and its path `dtcc_core/schemas/dtcc.proto`), `readers/package-reader.ts`, `readers/package-reader.spec.ts`, `readers/city.reader.ts`, `readers/readers.ts`
- Create: `apps/backend/test/fixtures/city-small.dtccpkg` (copied from `~/.gstack/tmp/phase1-fixtures/`)
- Add dependencies: `protobufjs`, `yauzl`, `@types/yauzl`; make sure the `.proto` is copied into the build output (Nest `assets`).

**Interfaces:**

- `readModel(source: Readable, maxBytes: number): Promise<DtccModelFile>`: reads the zip, takes `artifacts/model.dtcc`, rejects a member whose uncompressed size exceeds `maxBytes` before inflating, decodes `DTCC.ModelFile` with `protobufjs` (`loadSync` of the copied `.proto` once, `lookupType`; no generated code), requires `format == "dtcc-model"` and `version == 6`. `DtccModelFile` is a narrow hand-written type covering only the fields read (`format`, `version`, `object.kind`, `object.children`); kinds are compared through `lookupEnum("DTCC.Object.Kind")` by name, not by number. Calls are serialized: one read at a time per process. `class PackageReadError extends Error`.
- `type Reader = (model: DtccModelFile) => Record<string, unknown>`; `READERS: Record<string, Reader>` with `city`: requires a root object of kind `CITY`, returns `{buildings: N}` (direct children of kind `BUILDING`).

- [x] **Step 1: Write failing tests:** the fixture through `readModel` and the `city` reader returns `{buildings: 21}`; a non-zip buffer, a zip without `artifacts/model.dtcc`, and the fixture with `maxBytes: 1_000_000` each reject with `PackageReadError`; a root that is not `CITY` makes the `city` reader throw `PackageReadError`; two concurrent `readModel` calls do not overlap (spy on decode start and end).
- [x] **Step 2:** Run `pnpm --filter backend test package-reader`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run. Expected: PASS. Optionally, check the 2 km² package from `~/.gstack/tmp/phase1-fixtures/sizing/a2km2.dtccpkg` by hand: 1,208 buildings. List changed files.

### Task 6: Model clients

**Files:** Create `apps/backend/src/infra/model/model.client.ts`, `anthropic.model-client.ts`, `bedrock.model-client.ts`, `scripted.model-client.ts`, `scripted.model-client.spec.ts`, `model.cost.ts`, `model.cost.spec.ts`, `model.module.ts`; add `@anthropic-ai/sdk` and `@anthropic-ai/bedrock-sdk`; declare in `src/config/env.schema.ts` and `.env.example`: `AGENT_MODEL_PROVIDER` (`bedrock` | `anthropic` | `scripted`, default `scripted`), `AWS_BEARER_TOKEN_BEDROCK`, `AGENT_BEDROCK_REGION` (`eu-north-1`), `ANTHROPIC_API_KEY`, `AGENT_MODEL` (optional; defaults `eu.anthropic.claude-sonnet-5-5` for `bedrock`, or the id Task 1 recorded, and `claude-sonnet-5-5` for `anthropic`). Validation fails at boot when the chosen provider's key is missing.

**Interfaces:**

- `abstract class ModelClient { abstract readonly provider: string; abstract readonly model: string; abstract reply(request: ModelRequest, opts: {signal: AbortSignal; onText: (delta: string) => void}): Promise<ModelReply> }`; `ModelRequest = {system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]}`; `ModelReply = {content: Anthropic.ContentBlockParam[]; stopReason: Anthropic.StopReason | null; usage: ModelUsage}`; `class ModelUnavailableError extends Error`.
- `BedrockModelClient`: the Task 1 client, `messages.stream(...)` with the Sonnet 5.5 settings, `tool_choice: {type: "auto"}`, `on("text")` → `onText`, `finalMessage()`; no server-side `fallbacks` on Bedrock, so a `refusal` is handled by the turn runner. `AnthropicModelClient`: the same with `client.beta.messages.stream`, `fallbacks: "default"` and its beta. Provider errors become `ModelUnavailableError` with the provider's message; the key never appears in it.
- `ScriptedModelClient`: answers from an injectable script (`(request) => ModelReply` steps) for tests; with no script, a fixed rule: a question with "how many buildings" calls `run_city` once, then answers from the tool result; anything else answers in text. Streams its text in a few deltas. (Pattern: `ai-integration` `src/infra/model/scripted-model.ts`.)
- `modelCost(provider, model, usage): number` in USD: `claude-sonnet-5-5` on `anthropic` at $2 / $10 per MTok, cache reads $0.20, cache writes $2.50; `eu.anthropic.claude-sonnet-5-5` on `bedrock` from AWS's Bedrock price page for `eu-north-1` at implementation time, with the source and date in a `// REVIEW:` note.
- `ModelModule` binds `ModelClient` to the adapter `AGENT_MODEL_PROVIDER` names.

- [x] **Step 1: Write failing tests:** the scripted client returns its script's steps in order and streams text through `onText`; with an aborted signal it rejects; `modelCost` for 1M input, 1M output, 1M cache-read and 1M cache-write tokens on `anthropic` equals `14.7`; env validation rejects `AGENT_MODEL_PROVIDER=anthropic` without `ANTHROPIC_API_KEY`.
- [x] **Step 2:** Run `pnpm --filter backend test model env.schema`. Expected: FAIL.
- [x] **Step 3:** Implement. The Anthropic and Bedrock adapters have no unit tests against the network; they are checked in Task 13.
- [x] **Step 4:** Run. Expected: PASS. List changed files.

### Task 7: Tools and job reports

**Files:** Create `apps/backend/src/modules/agent/agent.tools.ts`, `agent.tools.spec.ts`; add `AGENT_DATASETS`, `AGENT_JOB_WAIT_MS`, `AGENT_MAX_MODEL_MB` to the env schema and `.env.example`.

**Interfaces:**

- Consumes: `JobsService.create(userId, {dataset, parameters})`, `JobsService.get(userId, id)`, `JobsService.package(userId, id)`; `DatasetsService.list()`; `AgentRepository.linkJob`, `findReusableJob`; `readModel`, `READERS`.
- `type ToolContext = {userId: string; chatId: string; bounds: SwerefBounds | null; signal: AbortSignal; status: (message: string) => void; jobStarted: (jobId: string, dataset: string) => void}`; `type ToolOutcome = {block: Anthropic.ToolResultBlockParam; call: {toolUseId, tool, dataset: string | null, jobId: string | null}; reportedJobId: string | null}`.
- `AgentTools.definitions(): Promise<Anthropic.Tool[]>`: one `run_<dataset>` per enabled Dataset that Engine lists, its `input_schema` from `argsSchema` without `bounds` and `format` (properties and `required`), sorted by name, then `get_job` and `list_available_data`. When Engine is unavailable, only `get_job` and `list_available_data`. (Pattern: `ai-integration` `chat-tools.ts` `datasetTool`.)
- `AgentTools.run(ctx, use): Promise<ToolOutcome>`: never throws for Engine, job or reader failures; returns `is_error: true` with one sentence the model can explain. `run_<dataset>`: no bounds → error asking for an area; reuse or `create` with `{...input, bounds}`; `linkJob`; `jobStarted`; `status("Running <title> for your area…")`; read the job every 2 s until finished, `signal` aborts, or `AGENT_JOB_WAIT_MS` passes.
- `AgentTools.report(userId, job): Promise<JobReport>`: the report as in the design; for a completed job, the manifest's headline, summary and warnings from the package, plus `READERS[job.dataset]` facts; a `PackageReadError` becomes `note: "The job completed, but its result could not be read."`. `reportedJobId` is set when the report is of a finished job.
- `list_available_data`: every Dataset's name, title, description, and `"can run now"` or `"not yet"`.

- [x] **Step 1: Write failing tests** with stubbed services and fake timers: definitions hold `run_city`, `get_job`, `list_available_data` and no tool for a Dataset not enabled, and `run_city`'s schema has no `bounds`; a job completing within the wait returns a report with `buildings: 21` from the fixture package and calls `create` once with the stored bounds; a reusable job skips `create`; a job still running at the deadline returns `state: "running"` and the "will be posted" note with `reportedJobId: null`; a failed job and an `EngineUnavailableError` return `is_error`; no bounds returns the area error without calling `create`; an aborted signal stops waiting; an unknown tool returns `is_error`; `get_job` for another user's id returns `is_error`; a corrupt package gives the "could not be read" note; `list_available_data` marks only `city` as can run now.
- [x] **Step 2:** Run `pnpm --filter backend test agent.tools`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run. Expected: PASS. List changed files.

### Task 8: Messages, prompt and turn runner

**Files:** Create `apps/backend/src/modules/agent/agent.messages.ts`, `agent.messages.spec.ts`, `agent.prompt.ts`, `agent.turns.ts`, `agent.turns.spec.ts`.

**Interfaces:**

- `agent.messages.ts`: constructors for stored messages (`userMessage(text, area, bounds)` with a `<map_context>` text block before the user's text, naming the bounds and size in km² or saying none is drawn; `assistantMessage(content)`; `toolResults(outcomes)`; `jobUpdate(reports)` with one `<job_update>` text block per report; `notice(text)`); `toModelMessages(stored)` (every message except notices, as stored); `toEntries(stored)` for the transcript. (Pattern: `ai-integration` `chat-messages.ts`.)
- `SYSTEM_PROMPT` as in the design; `PROMPT_VERSION` = first 12 hex characters of sha256 of `SYSTEM_PROMPT`.
- `AgentTurnRunner.run(chat: {id, userId}, trigger: "message" | "job_update", opts: {signal: AbortSignal; onEvent?: (e: AgentEvent) => void}): Promise<{turnId: string; outcome}>`. The caller holds the chat's lock. Reads the stored history, builds the request (system with `cache_control`; tools with `cache_control` on the last; `cache_control` on the last message), calls `ModelClient.reply` up to 6 times, appends each assistant `content` and each tool round's results as they happen, emits `text` deltas, `status` and `job` events, and stores the turn's record with `modelCost` and `PROMPT_VERSION`. Refusal → a notice, outcome `refused`. Provider error → a notice, outcome `failed`. Abort or deadline → a closing `tool_result` for an open `tool_use` and a notice, outcome `failed` with `client_disconnected` or `timed_out`. Six calls without an answer → a notice, outcome `stopped`.

- [x] **Step 1: Write failing tests** with the scripted client and stubbed tools: no tool → one call, `answered`, the streamed deltas equal the stored text; one `tool_use` → two calls, and the second request's messages end with the `tool_use` and its `tool_result`; two `tool_use` blocks in one reply → both run and their results go back in one message; six consecutive `tool_use` replies → `stopped` with a notice; `refusal` → `refused`, no tool run, and the refused content is not stored; a provider error → `failed` with a notice; an abort during a tool → a closing `tool_result`, so the stored history is valid for the next request; a stored history with `thinking`, tool and job-update blocks is sent as the request's leading messages byte-identical (`JSON.stringify` equal); `tool_choice` is always `auto`; the turn record has tokens, cost, provider, model, prompt version and the job ids; `toEntries` shows a job card for a started job and hides tool blocks.
- [x] **Step 2:** Run `pnpm --filter backend test agent.messages agent.turns`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run. Expected: PASS. List changed files.

### Task 9: Service, routes and module

**Files:** Create `apps/backend/src/modules/agent/agent.service.ts`, `agent.controller.ts`, `agent.module.ts`; modify `apps/backend/src/app.module.ts`; add `AGENT_MAX_AREA_KM2` and `AGENT_QUESTIONS_PER_DAY` to the env schema and `.env.example`; test `apps/backend/test/e2e/agent.e2e-spec.ts`.

**Interfaces:**

- Routes as in the design, `@Roles("user")`, `@CurrentUser()`, schemas from Task 2. `POST /api/agent/chats/:id/messages` is `@StreamResponse(agentEventSchema)`, writes `text/event-stream` frames `data: <json>\n\n`, each validated with `agentEventSchema`, and passes an `AbortSignal` that fires when the client disconnects.
- `AgentService.ask(userId, chatId, body, emit, signal)`. Checks before the stream opens, in order: user `active` (else `403`); chat found (else `404`); `countMessageTurnsSince(userId, 24) < AGENT_QUESTIONS_PER_DAY` (else `429 AGENT_DAILY_LIMIT`); area, if given, at most `AGENT_MAX_AREA_KM2` (else `422 AGENT_AREA_TOO_LARGE`); `claimTurn` (busy → `409 AGENT_CHAT_BUSY`). Then, holding the lock: deliver any ended jobs first (one job update, marked reported); store the user message; run the turn under `AbortSignal.any([signal, AbortSignal.timeout(110_000)])`; release the lock in `finally`; emit `done` or `error`. The title is set from the first question: whitespace collapsed, cut to 60 characters with `…`.
- `AgentService.get(userId, id)` returns the detail: entries, the chat's jobs read with `JobsService.get`, `waitingJobs`, `answering`, and the last user message's area.

- [x] **Step 1: Write failing e2e tests** (scripted model provider, stub Engine as `jobs.e2e-spec.ts` does, watcher off): a question streams `status`, `job`, `text`, `done`, stores the messages and a turn record with tokens, cost, provider, model, prompt version and job id; a job the stub leaves running streams an answer saying it will be posted, and the chat's detail has `waitingJobs: 1`; every route answers `404` for another user's chat and `401` without a session; a pending user gets `403`; a 101st question in 24 h gets `429 AGENT_DAILY_LIMIT`; an area over 5 km² gets `422 AGENT_AREA_TOO_LARGE`; `area: null` is accepted and the assistant's tool call gets the area error; two simultaneous asks to one chat give one stream and one `409 AGENT_CHAT_BUSY`; asks to two different chats of one user both run; aborting mid-job leaves the turn `failed` with `client_disconnected`, the lock free, and a later ask succeeds; `GET /api/agent/chats/:id` returns the last user message's `area`; `PATCH` renames; `DELETE` removes the chat and its messages and keeps the job.
- [x] **Step 2:** Run `pnpm --filter backend test:e2e agent`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run the e2e tests, then `pnpm --filter backend lint` and `pnpm --filter backend typecheck`. Expected: PASS. List changed files.

### Task 10: Watcher: jobs that end after their turn

**Files:** Create `apps/backend/src/modules/agent/agent.watcher.ts`; modify `agent.service.ts`, `agent.module.ts`; add `AGENT_RESUME_INTERVAL_SECONDS` (default 5; 0 turns it off) to the env schema and `.env.example`; set it to 0 in `apps/backend/test/setup-env.ts`; test `apps/backend/test/e2e/agent-watcher.e2e-spec.ts`.

**Interfaces:**

- `AgentService.resumeFinished(): Promise<void>`: `findChatsWaiting()`; for each, up to 4 at a time: read its unreported jobs with `JobsService.get`; if none has ended, skip without locking; else `claimTurn` (busy → skip until the next run), store one job update for every ended job and mark them reported in the same transaction, run a `job_update` turn without events, release the lock. A failing chat is logged and does not stop the others.
- `AgentWatcher` runs `resumeFinished` with `every()`, from `onApplicationBootstrap` to `onModuleDestroy`.

- [x] **Step 1: Write failing e2e tests** (scripted model, stub Engine): a chat whose job the stub then completes gets, after one `resumeFinished`, one `job_update` message with the reader's count and one `job_update` turn, and `waitingJobs: 0`; a second `resumeFinished` adds nothing; a chat whose lock is held is skipped and delivered on the next run after release; two concurrent `resumeFinished` calls deliver once; a job still running is not delivered and the chat is not locked; a failed job is delivered with its error; `job_update` turns do not count toward the daily limit; a user message sent after a job ended but before the watcher ran stores the job update first, and the turn answers both.
- [x] **Step 2:** Run `pnpm --filter backend test:e2e agent-watcher`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run, then `pnpm --filter backend test:e2e agent`. Expected: PASS. List changed files.

### Task 11: Frontend API and event stream

**Files:** Create `apps/frontend/src/api/agent.ts`, `apps/frontend/src/features/agent/event-stream.ts`, `event-stream.spec.ts`.

**Interfaces:**

- `parseEventStream(chunks: AsyncIterable<string>): AsyncGenerator<AgentEvent>`: splits on blank lines, reads `data:` lines, validates with `agentEventSchema`, skips invalid frames.
- `agentQueries.list({limit})`, `agentQueries.detail(id)` with `refetchInterval` 3,000 ms while `answering` or `waitingJobs > 0`, otherwise none; `agentMutations.create()`, `.rename()`, `.delete()` (invalidate `["agent"]`), following `apps/frontend/src/api/jobs.ts`.
- `askQuestion(chatId, body, onEvent, signal)`: first `api.get` of the chat (refreshes an expired token, as `jobMutations.download` does), then `fetch` `POST /api/agent/chats/:id/messages` with credentials; a non-2xx response becomes an `error` event from the response's error body.

- [x] **Step 1: Write failing tests:** for `parseEventStream`, a frame split across two chunks yields one event, two frames in one chunk yield two, an invalid frame is skipped; for the detail query, the refetch interval is 3,000 while `waitingJobs` is 1 and off when it is 0.
- [x] **Step 2:** Run `pnpm --filter frontend test event-stream agent`. Expected: FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run. Expected: PASS. List changed files.

### Task 12: The chat panel

**Files:** Create `apps/frontend/src/features/agent/agent-panel.tsx`, `chat-list.tsx`, `chat-view.tsx`, `composer.tsx`; modify `apps/frontend/src/features/workspace/workspace-store.ts` (add `"agent"` to `RightContent`), `apps/frontend/src/features/workspace/workspace.tsx`, `apps/frontend/src/features/workspace/toolbar/toolbar.tsx`.

**Interfaces:** Consumes Task 11. Restoring an area uses the pattern in `apps/frontend/src/features/saved-areas/saved-areas-panel.tsx` (`setArea` and `useMap()[workspaceMapId]?.fitBounds(..., {padding: 80})`). The job card reuses the Downloads panel's job display.

- [x] **Step 1:** Write tests first for the composer (proportionate to risk, per the frontend conventions): Send is disabled while a turn runs; an area over the limit shows a warning; a failed send puts the text back with the error.
- [x] **Step 2:** Build the panel: chat list (newest first, new, rename, delete); chat view with entries, the streamed answer, the `status` line, job cards, job-update lines and notices; the composer naming the current area or saying none is drawn; opening a chat with an `area` restores it on the map.
- [x] **Step 3:** Run `pnpm --filter frontend lint`, `typecheck` and `test`. Expected: PASS.
- [x] **Step 4:** Run the app (`pnpm dev`) with `AGENT_MODEL_PROVIDER=scripted` and a local Engine, open the panel, and check each behaviour. List changed files.

### Task 13: Demo acceptance

- [x] **Step 1:** Run Engine and the backend with `AGENT_MODEL_PROVIDER=bedrock` and the Bedrock key in `apps/backend/.env`. Engine: `pnpm dev:engine`, or the develop Engine already running on `127.0.0.1:8000` (token `phase1-token`, from the clone in `~/.gstack/tmp/twin-develop`).
- [x] **Step 2:** Walk the design's acceptance list (items 1–9). Item 1: draw `{west: 11.97, south: 57.686, east: 11.98, north: 57.692}` (bounds `[319370, 6397763, 319996, 6398458]`); the answer's number equals the count of `BUILDING` children in that job's package. Item 2: draw about 2 km² around Chalmers (the 2026-11-07 run of `[319000, 6397500, 320414, 6398914]` gave 1,208 buildings in 78 s). Record each item's result, the job times and the turn costs in a short note for Spiros and Napo.
- [ ] **Step 3:** If `ANTHROPIC_API_KEY` is set, repeat item 1 with `AGENT_MODEL_PROVIDER=anthropic`.
- [ ] **Step 4:** Run `pnpm check`. Expected: PASS. List all changed files for the commit.

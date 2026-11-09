# Agent phase 1: a chat that answers questions about a drawn area

Design, 2026-11-06, revised 2026-11-07. Agreed in conversation with Spiros; Napo reviews the
implementation. Verified against dtcc-twin `develop` `0312f82` (Engine with Core `17c6efe`). This
document replaces, for phase 1 only, the backend plan in #19; #18's tool server is deferred to phase 3.

## Why

The team decided (2026-11-04) to move dtcc-agent into dtcc-twin in phases, starting with the smallest
end-to-end loop instead of the full port: a signed-in user asks a question about an area they drew,
and Twin answers it with Engine jobs and a model, with no MCP and no tool server. Phase 1 is a demo
for the team, but it is not throwaway: it is built on the real parts (Twin's sign-in, `JobsService`,
Postgres, the real SSE route) so the MVP grows from it.

## What changed on 2026-11-07

Napo built a one-off chat on the `ai-integration` branch (8 commits, 2026-11-06, no pull request). It
is not merged or built on; it was read to test our decisions. What we took from it, and what we
measured:

| Was                                                          | Now                                                                                                                                                  | Why                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two fixed tools, `count_buildings` and `list_available_data` | One `run_<dataset>` tool per enabled Engine Dataset, with a reader per Dataset that adds facts to the job's report; `get_job`; `list_available_data` | More Datasets arrive without new tools; `city` is the only one enabled at first                                                                         |
| One question waits up to 110 s for its job                   | A tool waits briefly (45 s); a longer job is reported in the chat when it ends, by a watcher in our module                                           | Jobs of a few km² take 80 s and more; phase 2's simulations take hours                                                                                  |
| One running question per user, by a unique index             | One turn per chat, by a lock that expires                                                                                                            | A crashed turn frees itself; background turns don't block the user's other chats                                                                        |
| 30 questions per chat; area required; 25 km²                 | 100 questions per user per 24 h; area optional; 5 km² by default, configurable                                                                       | Team decisions of 2026-11-07, and the measurements below                                                                                                |
| Bedrock only, behind no interface                            | Our own `ModelClient`: Bedrock first, the Anthropic API second, a scripted stand-in for tests; OpenAI in phase 1.5                                   | The team's Bedrock key works (checked 2026-11-07) and keeps processing in the EU; the Anthropic API (Vasilis's credit) and OpenAI stay one adapter away |
| `agent_questions`                                            | `agent_turns`, one per model turn, a user's message or a job's report                                                                                | A job's report runs a turn with no question                                                                                                             |

Kept from our design: SSE answers, cost in USD and prompt version per turn, the map moving to a
chat's last area, the protobuf reader.

**Measured on 2026-11-07** (local Engine from `develop`, Chalmers, `city`):

| Area     | Job    | Package | Model uncompressed | Decode (Node, `protobufjs`) | Peak memory | Buildings |
| -------- | ------ | ------- | ------------------ | --------------------------- | ----------- | --------- |
| 0.03 km² | 31.7 s | 0.9 MB  | 2.3 MB             | < 0.1 s                     | 62 MB       | 21        |
| 0.36 km² | 12.2 s | 8.95 MB | 24.7 MB            | –                           | –           | 278       |
| 2 km²    | 78 s   | 57 MB   | 159 MB             | 0.1 s                       | 257 MB      | 1,208     |
| 5 km²    | 86 s   | 136 MB  | 383 MB             | 0.2 s                       | 579 MB      | 3,296     |

Memory, not time, limits the area: about 1.5 times the model's size, so 25 km² would need about
1.9 GB per read. Engine refuses any `format` other than its canonical package
(`"Engine delivers every job as a canonical .dtccpkg; remove the 'format' parameter"`), and the
manifest has no counts, so the protobuf model is the only source of counts and, in phase 1.5, of
footprints. Chalmers is dense; a rural area is not measured.

## What the demo must do

1. **"How many buildings are there here?"** The answer comes from a `city` job for the drawn area and
   the `city` reader's count. A job that finishes within the wait is answered in the same turn; a
   longer one is answered in the chat when it ends, without the user asking again.
2. **"What data can you get for this area?"** Answered from Engine's catalogue (28 Datasets on
   `develop`), saying which the assistant can run now, with no job.
3. **A follow-up in the same chat**, including after the user redraws the area: the new area is used.
4. **A clear answer for what phase 1 cannot do**: trees, simulations, 3D, Datasets not enabled, an
   area over the limit. With no area drawn, the assistant asks for one. It never invents a number.
5. **Chat history**: the user lists earlier chats and reopens one; the map moves to the area that
   chat was last about.

## Goals, non-goals, anti-goals

- **Goals:** the five behaviours above, for any signed-in, active Twin user; the code is the base of
  the MVP.
- **Non-goals (phase 1):** trees and building footprints (Core cannot package `TreeCollection` or
  `FootprintCollection`, dtcc-core#160); simulations; MCP or the tool server (#18, phase 3); drawing
  results on the map and the OpenAI adapter (phase 1.5); a spend cap; chat retention rules; the eval
  harness; changing how the jobs module refreshes jobs.
- **Anti-goals:** the model choosing or inventing coordinates; a number in an answer that did not come
  from a job's report (enforced by the system prompt and checked in the demo); one user reading
  another's chat; parts of the demo that have to be thrown away for the MVP.

## How it works

```
Panel ──POST /api/agent/chats/:id/messages {text, area?}──► agent module ──► ModelClient
  ▲   SSE: status, text, job, done | error                     │  ▲           (Bedrock | Anthropic API)
  │                                                            │  └── tool_result: job report
  │                                     run_city ──► JobsService.create ──► Engine city job
  │                                     wait ≤ 45 s: JobsService.get ──► package ──► city reader
  │
  └── GET /api/agent/chats/:id every 3 s while the chat waits on a job
                                        agent.watcher.ts (every 5 s) ──► JobsService.get
                                          finished ──► job update ──► model turn, stored in the chat
```

**A question** runs in one SSE response:

1. The panel sends the text and the drawn area in degrees (the area store's `Area`), or none.
2. Before storing anything, the backend checks: the account is `active`; the chat is the caller's;
   fewer than 100 questions from this user in the last 24 hours; an area, if sent, within
   `AGENT_MAX_AREA_KM2`; the chat's lock is free. A failed check is an HTTP error and nothing is
   stored: `403` inactive, `404` not theirs, `429` daily limit (`AGENT_DAILY_LIMIT`), `422` area too
   large (`AGENT_AREA_TOO_LARGE`), `409` chat busy (`AGENT_CHAT_BUSY`). The panel prevents what it can.
3. The backend takes the chat's lock, stores the user's message with the area in degrees and as
   EPSG:3006 bounds, and runs a **turn**: the model with the system prompt, the tools, and the chat's
   history; any tool calls; the model again with their results; at most 6 model calls. The answer
   streams as it is written.
4. If a job finishes within the wait, its report is the tool's result. If not, the tool's result says
   the job is running and its result will be posted in the chat; the model says so.
5. The backend stores the turn's record (tokens, cost, model, provider, prompt version, job ids,
   duration, outcome), releases the lock and sends `done`. The whole turn has a deadline of 110 s,
   under nginx's 120 s on `/api/` (`apps/frontend/nginx.conf:37`).

**A job that ends later** is reported by the watcher. Every `AGENT_RESUME_INTERVAL_SECONDS` (5) it
lists the chats with unreported jobs and reads each job with `JobsService.get`, which asks Engine as
it does for the Downloads panel. When one has ended, the watcher takes the chat's lock (or leaves the
chat for its next run), runs the reader, stores one job update for every ended job, marks them
reported, and runs a turn on it, without streaming. A job update that arrives just before the user's
next message is stored first, so that turn answers both.

The jobs module is not changed: it keeps refreshing on read, and Engine is asked only about jobs a
chat waits on.

### Tools

Neither the model nor the user gives coordinates: tools that need an area use the bounds stored with
the chat's latest user message.

| Tool                  | Input                                                                              | What the backend does                                                                                                                                                                                                                                                           | Result to the model                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `run_<dataset>`       | The Dataset's parameters from Engine's `argsSchema`, without `bounds` and `format` | Without an area, an error asking for one. Reuses a job of the same user, Dataset and parameters from the last 24 h that has not failed; otherwise `JobsService.create`. Links the job to the chat, then reads it with `JobsService.get` every 2 s for up to `AGENT_JOB_WAIT_MS` | The job's report (below), or an error the model can explain                                    |
| `get_job`             | `job_id`                                                                           | `JobsService.get` for the caller                                                                                                                                                                                                                                                | The job's report                                                                               |
| `list_available_data` | none                                                                               | `DatasetsService.list()`                                                                                                                                                                                                                                                        | Name, title and description of every Dataset, each marked "can run now" (enabled) or "not yet" |

`run_<dataset>` tools exist for the Datasets in `AGENT_DATASETS` (default `city`), sorted by name so
the cached prefix is stable. A Dataset whose name is too long for a tool name is left out.

**A job's report** is a small JSON object: `job_id`, `dataset`, `state`; while running, its progress
and a note that the result will be posted in the chat; when failed, the error; when completed, the
manifest's `presentation.headline`, `presentation.summary` and `warnings`, plus the facts from the
Dataset's reader if it has one. The rest of the manifest (licence, provenance, narrative) stays out.

**Readers** turn a completed job's package into facts. Phase 1 has one: `city`, which counts the root
`CITY` object's direct children of kind `BUILDING` in `artifacts/model.dtcc` and adds
`{"buildings": N}`. A Dataset without a reader reports only the manifest's lines, so the model says
what was produced but gives no numbers. When Core puts a summary in the manifest, readers that only
count can go; the `city` reader stays for the footprints of phase 1.5.

### Reading a package

The package is read from Twin's storage through `JobsService.package`. The reader takes the
`artifacts/model.dtcc` member from the zip, refuses one whose uncompressed size is over
`AGENT_MAX_MODEL_MB` (512) before inflating it, decodes `DTCC.ModelFile` with types from `dtcc.proto`
(copied into the backend at Core `17c6efe`, with the pin noted, and loaded with `protobufjs` at
startup; no generated code), and requires format `dtcc-model`, version 6 and a root `CITY` object.
The decoded model is typed by a narrow hand-written `DtccModelFile` covering only the fields read
(phase 1: `format`, `version`, `object.kind`, `object.children`), compared by enum name, not number. One package is read at a time per backend process, so peak memory stays near
0.6 GB however many jobs end together.

Core is asked (Anders), in parallel and not blocking: package `TreeCollection` and
`FootprintCollection` (dtcc-core#160), and a per-result summary in `manifest.json` (counts per object
kind, bounds).

## Backend (`apps/backend/src/modules/agent/`)

Follows `apps/backend/CONVENTIONS.md`: `JobsService`, `DatasetsService` and `UsersService` through
their exported services; contracts in `packages/contracts/src/agent`. The model provider is reached
only through `src/infra/model/`.

**Tables (Drizzle):**

- `agent_chats`: id, user_id (cascade), title (the first question, shortened), `turn_started_at`
  (the lock: free when null or older than 10 minutes), timestamps.
- `agent_messages`: id, chat_id (cascade), `seq` (unique per chat), `kind` (`user`, `assistant`,
  `tool_results`, `job_update`, `notice`), `content` (exactly what the model was sent or answered,
  null for a notice), `data` (what the transcript shows: the user's text and area in degrees and
  bounds, tool calls with their job ids, job states, notice text), created_at.
- `agent_chat_jobs`: chat_id (cascade), job_id (cascade with the job), dataset, parameters, reported,
  created_at; an index on unreported rows.
- `agent_turns`: id, chat_id (set null), user_id (cascade), trigger (`message`, `job_update`),
  outcome (`answered`, `refused`, `failed`, `stopped`; a turn past its deadline is `failed` with error code `timed_out`), provider, model, prompt version,
  input, output, cache-read and cache-write tokens, cost in USD, model calls, job ids, duration,
  error code, timestamps. The daily limit counts its `message` rows.

**Routes** (`@Roles("user")`, `@CurrentUser()`; every query names the owner):

| Route                                | Purpose                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/agent/chats`              | New, empty chat                                                                                                               |
| `GET /api/agent/chats`               | The caller's chats, newest first, paginated like jobs                                                                         |
| `GET /api/agent/chats/:id`           | The chat's transcript, its jobs, how many it still waits on, whether a turn is running, and the area of its last user message |
| `PATCH /api/agent/chats/:id`         | Rename                                                                                                                        |
| `DELETE /api/agent/chats/:id`        | Delete the chat and its messages; its jobs stay in Downloads                                                                  |
| `POST /api/agent/chats/:id/messages` | One question, answered as server-sent events                                                                                  |

**SSE events** (zod schemas in `packages/contracts/src/agent`, each validated before it is sent):
`status` (a short line), `text` (a delta of the answer), `job` (a job was started or reused: its id
and Dataset), `done` (the turn's id), `error` (code and message). The streaming route declares
`@StreamResponse(agentEventSchema)`; the contract-coverage test accepts it, and `CONVENTIONS.md` gets
the rule, for Napo's review.

**Model:** `ModelClient`, our own interface in the Anthropic Messages format, with three adapters
chosen by `AGENT_MODEL_PROVIDER`:

- `bedrock`: Bedrock in `eu-north-1` (`@anthropic-ai/bedrock-sdk`, `AWS_BEARER_TOKEN_BEDROCK`),
  model `eu.anthropic.claude-sonnet-5-5` (the EU inference profile; the bare `anthropic.` id is
  refused on demand). Checked 2026-11-07 with the team's key: InvokeModel with the Messages body,
  adaptive thinking, effort `low`, `tool_choice` `auto` and a tool answers with `tool_use`. Used for
  development and the demo, and the likely production provider: processing stays in EU regions.
  The client is `AnthropicBedrockMantle` if it accepts the key and profile, otherwise
  `AnthropicBedrock` (InvokeModel, verified).
- `anthropic`: the Anthropic API (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`), model
  `claude-sonnet-5-5`, with the server-side refusal fallback on (`fallbacks: "default"`). Optional,
  on Vasilis's credit, for development with test accounts only: it cannot keep processing in the EU.
- `scripted`: a stand-in that answers from a script, for tests and for working without a key.

Every adapter streams. Sonnet 5.5 settings: `tool_choice` `auto` only; thinking on (adaptive),
`max_tokens` 4,096, effort `low`; the history is append-only, and every assistant `content` is stored
and sent back unchanged, thinking blocks included; `refusal` and `max_tokens` stop reasons are checked
before content is read. Prompt caching marks the system prompt with the tools and the end of the
history. Cost is computed from token counts with each provider's rates and stored; nothing blocks on
cost. An OpenAI adapter (EU data residency) comes in phase 1.5 and converts messages at its edge.

**System prompt:** written for phase 1. What Twin is; the app puts a `<map_context>` block before each
user message, naming the area or saying none is drawn, and puts job updates in `<job_update>` blocks,
neither written by the user; never give coordinates; how jobs run and are reported; answer numbers
only from job reports; what is coming later. It holds nothing that varies between requests.

**Failure handling:** a client disconnect stops the model call; the job continues and is reported
later. A provider error or the deadline ends the turn with an `error` event, a notice in the
transcript and a stored outcome. An Engine or job failure becomes a tool result the model explains,
never an exception. A turn that ends between a `tool_use` and its result stores a closing
`tool_result` so the chat's history stays valid. The lock is released however a turn ends, and frees
itself after 10 minutes if the process dies.

**Background work** follows the rule Napo proposed for `CONVENTIONS.md` (adopted here):
`agent.watcher.ts` runs one service method with a shared `every()` helper in
`src/common/background/`, which never overlaps runs and logs a failed run; the interval comes from the
environment, 0 turns it off; it starts in `onApplicationBootstrap` and stops in `onModuleDestroy`;
what it works through is in the database; e2e tests run with it off and call the method.

**Configuration** (`env.schema.ts` and `.env.example`): `AGENT_MODEL_PROVIDER` (default `scripted`),
`ANTHROPIC_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `AGENT_BEDROCK_REGION` (`eu-north-1`),
`AGENT_MODEL` (per provider default), `AGENT_DATASETS` (`city`), `AGENT_MAX_AREA_KM2` (5),
`AGENT_MAX_MODEL_MB` (512), `AGENT_QUESTIONS_PER_DAY` (100), `AGENT_JOB_WAIT_MS` (45000),
`AGENT_RESUME_INTERVAL_SECONDS` (5). Keys are secrets: never logged, never committed.

## Frontend (`apps/frontend/src/features/agent/`)

Built by Spiros (or the implementing agent), reviewed by Napo.

- A chat panel in the workspace's right panel (`workspace-store.ts`, `setRight`), opened from the
  toolbar like the others.
- The chat list (newest first), new chat, rename and delete.
- Sending: the text with the area store's current `Area`, or none; the composer names the area and
  warns before sending when it is over the limit; Send is disabled while a turn runs.
- The streamed answer, the `status` line, a job card for a job started (reusing the Downloads panel's
  job display), a line when a job's result was posted, and errors in plain words.
- While the chat waits on a job or a turn runs, the panel reloads the chat every 3 seconds and stops
  when nothing is left to change.
- Reopening a chat with an area sets the area store to it (`setArea`) and moves the map there
  (`fitBounds`), as the saved-areas panel does.

## Acceptance

1. "How many buildings are there here?" over a box of about 0.4 km² at Chalmers answers with the
   count of `BUILDING` children in that job's package, in the same turn, with the job in the user's
   Downloads.
2. The same over about 2 km² (a job of about 80 s) answers that the job is running, then posts the
   count in the chat when the job ends, without a new question; the panel shows it without a reload.
3. "What data can you get for this area?" lists Engine's Datasets and says which can run now, with no
   job.
4. A follow-up after redrawing uses the new area; the stored message has the new bounds.
5. Trees, a simulation or 3D get an answer with no number and no job. With no area, the assistant asks
   for one. An area over 5 km² gets `422` before the model is called.
6. Reopening a chat shows its messages and moves the map to its last area.
7. Another user's chat id answers `404` on every route; a pending or disabled account cannot ask.
8. A second message to a chat while it answers gets `409`; the 101st question in 24 hours gets `429`;
   a job update does not count.
9. Each turn has its tokens, cost, provider, model, prompt version and job ids stored.
10. Backend tests: the reader against the 21-building fixture, a corrupt package, a missing member and
    one over the size limit; the turn loop against the scripted model (tool round, no tool, refusal,
    error, deadline, disconnect, byte-identical replay); the lock, including expiry; the watcher
    delivering, skipping a locked chat, and not counting toward the daily limit; owner filtering on
    every route.

## Order of work

1. Contracts and the streaming response declaration, as the first pull request, for Napo's review.
2. Backend: model clients, tables, reader, tools, turns, routes, watcher. Frontend in parallel
   against the contracts.
3. Demo run against a local Engine from `develop` and the team's Bedrock key.

Execution: the implementation runs in a separate thread (Codex), following
[`phase-1-plan.md`](phase-1-plan.md); the result is reviewed, verified and tested in this one before
it goes to the team.

## Dependencies

- **Model provider.** Development and demo: Bedrock in `eu-north-1` with the team's key (a 30-day
  key; Vasilis confirms its expiry and that the demo's spend may run on the Chalmers account).
  Production: Bedrock unless Vasilis decides otherwise; the Anthropic API (no processing in the EU)
  and OpenAI (EU data residency, phase 1.5) stay one adapter away. Deployment needs outbound HTTPS to the chosen provider's
  endpoint opened (dtcc-infra, Vasilis); today the backend may reach only `api.dtcc.chalmers.se:443`
  and the Admin API (`docs/deployment.md:65`).
- **Core (in parallel, not blocking):** `TreeCollection` and `FootprintCollection` packaging, and a
  result summary in the manifest.

## Phase 1.5

- **Buildings on the map (2D):** the `city` reader also extracts each building's footprint (the bottom
  face of its LoD1 solid), reprojects it to WGS84 (`proj4`) and offers the panel GeoJSON, drawn as a
  MapLibre fill and outline layer. 3D (dtcc-twin#17) stays in phase 3.
- **OpenAI adapter** behind `ModelClient`, if Vasilis's GDPR answer points there.

## Left to the builder

The zip library (`yauzl` is measured with); the system prompt's wording;
the panel's visual design within Twin's components; how the title is shortened.

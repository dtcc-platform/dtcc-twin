# Agent in the backend and frontend: plan

> **Superseded for phase 1 (2026-11-07).** Phase 1 follows the [phase 1 design](phase-1-design.md) and [plan](phase-1-plan.md). The tool-server design below is deferred to phase 3 and kept for reference; parts of it may change when phase 3 is planned. Vasilis's review of it is on dtcc-twin#18.

Draft, proposed 2026-11-02, revised 2026-11-03, not started. Decisions: [decision log](decisions.md),
ADRs [0001](../adr/0001-agent-runs-in-the-backend-process.md) to
[0004](../adr/0004-chats-outlive-sessions.md), [tool map](tools.md). The tool server is Increment 8
in [`apps/engine/PLAN.md`](../../apps/engine/PLAN.md).

One module, `src/modules/agent/`, following `apps/backend/CONVENTIONS.md`: it uses the `jobs` and
`users` services, never their repositories. Contracts go in `packages/contracts`. Every pull request
starts with failing tests; `dtcc-agent`'s tests for the same behaviour are the specification to
port, not code to copy.

## Pull requests

**B1: Tables and repository.** Drizzle tables `chats` (owner, title, last used, and the current
Session's id and last activity), `chat_messages` (display transcript and the model's message
history), `agent_runs` (simulation, parameters, summary, the user's job id), `agent_artifacts`
(Chat, stored file, media type, size, hash), `agent_spend` (month, spent) with
`agent_spend_reservations` (id, amount, state, created), and `agent_turns` (provenance: cost,
tokens, tools, timings, prompt version, each tool call's operation record; no credentials).
`chats.user_id` cascades on user deletion, and a Chat's artifacts go with it. A scheduled task
deletes Chats unused for 90 days. Every query on a user's rows filters by owner.

**B2: Conversation loop and limits.** Anthropic's TypeScript SDK with the `AnthropicBedrock` client
and `eu.anthropic.claude-sonnet-5-5` (D19); the MCP TypeScript SDK as the tool client, against a stub
MCP server in tests.

- Every turn, and every tool call in it, first checks that the user's account is `active` now, from
  the user record: a valid token alone admits pending users, and disabled users until it expires.
- Tools: the model sees one list, the tool server's tools (from MCP's `tools/list`) and the
  backend's own (simulations and Runs, [tool map](tools.md)). Every argument is validated before
  use (ADR-0001). An argument that names a Run is a Run reference from this Chat's records; the
  backend turns it into the job id, after checking the job is the user's own, and the model never
  handles raw job ids.
- Prompt: the system prompt ported unchanged; tool descriptions changed only where behaviour
  changed: `run_simulation` returns a Run reference and runs asynchronously, `get_run_status`,
  `load_run_result` and `compare_runs` are new, and the GeoJSON tools are gone. The prompt version is recomputed from
  the actual prompt, as `dtcc-agent` does (a hash), so evals can tell the versions apart. Prompt
  caching as in `dtcc-agent`'s ADR-0006.
- Spend, keeping `dtcc-agent`'s invariant (`chatbot/limits.py`): before each Bedrock request, a
  reservation for its worst case is **committed** in its own transaction, refused if it would exceed
  the month's limit; after the request, a second transaction settles it at the actual cost. An
  unsettled reservation always counts, across restarts and month boundaries; a failure refunds only
  when Bedrock certainly did not answer. With a spend limit: output capped at 8,192 tokens and SDK
  retries off.
- Turns per Chat; the turn deadline as an `AbortSignal`; model requests at once, in process. Beta
  values: $90, 30, 180 s, 4; each off when unset.

**B3: Routes and the panel's contract.** `POST /api/agent/chats/:id/messages` answers one turn as
server-sent events; `GET /api/agent/chats`, `GET /api/agent/chats/:id`, `PATCH`, `DELETE`; a Chat's
artifacts, served only to its owner. The event types (text, tool progress, artifact, Run status,
done, error) are zod schemas in `packages/contracts`, and every event is validated before it is
sent. The streaming route needs a response declaration the contract-coverage test
(`test/e2e/contract-coverage.e2e-spec.ts`) accepts; this PR adds one, documented in
`CONVENTIONS.md`. Specified and tested: an error after the stream starts (an `error` event, then
close), the client disconnecting (the turn stops and its spend settles), and the deadline. nginx
already disables buffering on `/api/`; its 120 s read timeout is raised on this route only, above
the turn deadline.

**B4: Tool server integration.** Depends on E1–E3 in Increment 8.

- The MCP client calls the tool server through the gateway with Engine's token, stateless, with SSE
  responses (D8). Each call carries the Chat's Session id and the turn in headers. A Chat gets a new
  Session id when it has been idle for an hour, matching the tool server, which drops idle Sessions.
- Simulations: `run_simulation` submits through the `jobs` service as the user's job, records the
  Run and returns at once (D11, D21); `get_run_status` reads it there. The panel shows the job's
  progress, and its completion resumes the conversation (question 7).
- `load_run_result` and `compare_runs`: the backend checks the Run belongs to this Chat and its job
  is the user's own and completed, then passes the job id to the tool server's `load_job_package`
  (D9); `compare_runs` loads both and calls `compare_objects`. `compare_scenarios` starts both
  simulations and returns their Run references.
- Artifacts: when a tool result names a file, the backend fetches it from the tool server (E3),
  checks size and media type, and stores it with the Chat (ADR-0003).
- Each tool result's operation record goes into the turn's provenance (D25).

**B5: Per-user admission.** Before a simulation is submitted, whether by the Agent or by a user, it
is admitted atomically against the user's limit. This is L1's per-user limit, which does not exist
yet; the Agent is not enabled for users until it does. If L1 is built elsewhere, this PR is
replaced by it. The tool server's own work is bounded inside it (D14), not by job limits.

**F1: The chat panel (Napo).** React panel against B3's contract: Chat list, the streamed turn,
rendered images and downloads, a running simulation's progress. A 3D view of exported geometry can
follow with dtcc-twin#17.

## Dependencies and the first release

```
E1 ─► E2, E3 ─► B4
B1 ─► B2 ─► B3 ─► F1
B5 ─► enabling the Agent
```

No task waits for Core. The **first release** has every tool in the [tool map](tools.md).

## Acceptance

1. **Correctness has to be scored first.** `dtcc-agent`'s harness measures only
   (`eval/measure.py`: "nothing is scored right or wrong"). Before comparing: answer keys and a rubric
   owned by Anders or Nuri, first drafted by us; automatic checks for numbers and tool calls, a model
   judge for the rest, a human-reviewed sample each run (D32); plus scenarios for what changed:
   asynchronous simulations, and questions that used the GeoJSON tools.
2. On one day, with the same model, run the eval set against the port and against `dtcc-agent`
   `11f20bb` as a fresh M4 baseline (`dtcc-agent`'s ADR-0008). Required: answers as correct and tool
   calls as successful as the baseline. Reported: cost and time; a large change is explained.
3. Sizing: the same eval set run as 10 concurrent Chats, recording backend memory, the tool server's
   memory and Engine's queue wait, to answer dtcc-infra's sizing question and set the tool server's
   memory limit.
4. dtcc-infra's A4 checks: one paid Bedrock request, one tool call through the gateway, one
   simulation through the backend.

## For the operator, before the Agent is enabled

From dtcc-infra's open questions: accept ADR-0001's boundary; restate or withdraw the beta exception
and its scope, users and budget; the Bedrock grant on Twin's role; the tool server as a third
service with a backend-only gateway route. Sign-in instead of the shared access code is decided.

## Outside this plan

- Sonnet 5.5 on Bedrock's Messages endpoint, which would allow the `AnthropicBedrockMantle` client.
- A prompt rewrite, measured separately.
- The frontend's 3D view of results (dtcc-twin#17).
- Twin's own data (saved areas, jobs, settings) as backend tools of the agent.

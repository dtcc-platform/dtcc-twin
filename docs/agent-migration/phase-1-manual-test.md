# Agent phase 1: testing it by hand

How to run the chat locally and check each behaviour of the
[phase 1 design](phase-1-design.md). The [demo note](phase-1-demo.md) records one run of these checks.

## Setup

1. Install and start Postgres, as in the root README:

   ```sh
   pnpm install --frozen-lockfile
   cp apps/backend/.env.example apps/backend/.env   # first run only
   docker compose up -d --wait
   pnpm db:push && pnpm db:seed
   ```

2. Start Engine with `pnpm dev:engine` (port 8000, token `local-dev-engine-token`).

3. In `apps/backend/.env`:

   ```sh
   ENGINE_URL=http://127.0.0.1:8000
   ENGINE_API_TOKEN=local-dev-engine-token
   AGENT_MODEL_PROVIDER=bedrock            # or anthropic, or scripted (no key, canned answers)
   AWS_BEARER_TOKEN_BEDROCK=...            # for bedrock
   ANTHROPIC_API_KEY=...                   # for anthropic
   ```

   Keys stay in `.env`; never commit them. With `scripted`, a question containing "how many
   buildings" runs `run_city` once and answers from its result; anything else gets a canned reply.

4. `pnpm dev`, open <http://localhost:3000>, and log in as `alan@example.com` / `password`. Open
   the **Agent** panel from the workspace toolbar.

Shorter limits make some checks quicker; restart the backend after changing them:
`AGENT_QUESTIONS_PER_DAY=3`, `AGENT_JOB_WAIT_MS=5000`, `AGENT_MAX_AREA_KM2=1`.

## Checks

| #   | Do                                                                                                                      | Expect                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Draw a box of about 0.4 km² in Gothenburg (for example around Chalmers). New chat: "How many buildings are there here?" | A "Running city for your area…" status line and a job card; the count in the same answer if the job ends within `AGENT_JOB_WAIT_MS` (45 s). The job also appears in Downloads. |
| 2   | Draw about 2 km² and ask the same                                                                                       | The answer says the job is running and the result will be posted. When the job ends (about 1–2 minutes), the count appears in the chat on its own, without a reload.           |
| 3   | "What data can you get for this area?"                                                                                  | A list of Engine's Datasets, `city` as the one it can run now. No job card.                                                                                                    |
| 4   | In the same chat, redraw a different box and ask again                                                                  | The answer uses the new area (a new job, or "Using an earlier City result…" if one exists).                                                                                    |
| 5   | Ask about trees, a wind simulation or 3D                                                                                | A plain answer that it is not available yet, with no number and no job.                                                                                                        |
| 6   | Clear the area and ask a question                                                                                       | The assistant asks you to draw an area; no job.                                                                                                                                |
| 7   | Draw more than 5 km² and send                                                                                           | Refused before the model: an error under the composer (`422 AGENT_AREA_TOO_LARGE`).                                                                                            |
| 8   | Zoom the map away, then reopen an earlier chat from the list                                                            | Its messages show, and the map moves to the chat's last area.                                                                                                                  |
| 9   | Rename and delete a chat                                                                                                | The list updates; a deleted chat's jobs stay in Downloads.                                                                                                                     |
| 10  | Send a question, and while it runs send another from a second tab in the same chat                                      | The second gets `409 AGENT_CHAT_BUSY`.                                                                                                                                         |
| 11  | With `AGENT_QUESTIONS_PER_DAY=3`, ask a fourth question                                                                 | `429 AGENT_DAILY_LIMIT`. A posted job result does not count.                                                                                                                   |
| 12  | Close the tab while a job runs, then come back and open the chat                                                        | The job's result was posted while you were away.                                                                                                                               |
| 13  | Log in as `katherine@example.com` (pending) and ask                                                                     | `403`.                                                                                                                                                                         |
| 14  | As Ada, request one of Alan's chats by id (`curl` with Ada's cookie, or edit the URL the panel calls)                   | `404` on `GET`, `PATCH`, `DELETE` and `POST …/messages`.                                                                                                                       |

## What is stored

Each turn's record, with tokens, cost and the job it reported:

```sh
docker compose exec postgres psql -U app -d app -c \
  "select created_at, trigger, outcome, provider, model, prompt_version, input_tokens, output_tokens,
          cost_usd, model_calls, job_ids, duration_ms, error_code
     from agent_turns order by created_at desc limit 10;"
```

A chat's stored messages, as the model sees them:

```sh
docker compose exec postgres psql -U app -d app -c \
  "select seq, kind, left(content::text, 120) from agent_messages
     where chat_id = '<chat id>' order by seq;"
```

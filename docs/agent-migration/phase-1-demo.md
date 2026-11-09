# Agent phase 1: demo acceptance

Run on 2026-11-07, 10:43–10:54 UTC, for Spiros and Napo. The backend was built from this worktree with
`AGENT_MODEL_PROVIDER=bedrock` (`eu.anthropic.claude-sonnet-5-5`, `eu-north-1`) against the develop
Engine on `127.0.0.1:8000` (Compose project `twindev`, one worker). Questions went through
`POST /api/agent/chats/:id/messages` from a small script; items 2 and 6 were also checked in the panel
in a browser. Counts were checked independently: `unzip -p` of `artifacts/model.dtcc` from the stored
package, decoded with `protobufjs` and Core's `dtcc.proto`, counting the root `CITY` object's
`BUILDING` children.

Job times are from the job's `created_at` to its `completed_at`. Twin records completion when a read
sees it (every 2 s in a tool, every 5 s in the watcher), so each is accurate to about 5 s. Engine ran
jobs one at a time, so a job queued behind another took longer.

Two prompt versions were used: `46709cc3cb7b` (Codex's last prompt) for the first pass, and
`06a3165c4abc` after the plain-text change (see Findings) for a second pass of items 1–5. After the
review's fix round, items 1 and 2 were run again at 11:38–11:40 UTC (see "Rerun after the fix
round"); the error codes below are the ones of that run, before they became upper case.

## Results

| Item                    | Result                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Count, ~0.4 km²      | Pass after the rerun; see below | Bounds `[319370, 6397763, 319996, 6398458]` (0.44 km²). Two fresh jobs took 33 s and 37 s, longer than `AGENT_JOB_WAIT_MS` (20 s): the turn said the job was running, and the watcher posted **331** 2–3 s after each job ended. A user whose job for the area had already completed got 331 in the same turn (2.8 s). Package: 331 of 332 root children are `BUILDING`.                                                                   |
| 2. Count, ~2 km²        | Pass                            | Bounds `[319000, 6397440, 320415, 6398975]` (2.17 km²). Jobs took 117 s and 110 s. The turn ended at 23–24 s saying the result would be posted; the watcher posted **1,288** within 2 s of the job's end. In the panel, the job card went from Running (30 %) to Completed and the answer appeared without a reload. Package: 1,288 of 1,289. (The design's 1,208 was for a slightly different box, `[319000, 6397500, 320414, 6398914]`.) |
| 3. Catalogue            | Pass                            | Listed Engine's Datasets in groups, `city` as the only one it can run now; `list_available_data` called, no job (4.3–4.9 s).                                                                                                                                                                                                                                                                                                               |
| 4. Follow-up, redrawn   | Pass                            | Same chat, redrawn to the item 1 box: the stored user message has `[319370, 6397763, 319996, 6398458]`, and the answer was 331 for the new area. Second pass: redrawn to `[319591, 6398051, 319780, 6398282]`, a new job, 20 buildings posted later (job 83 s, queued behind item 2's; package: 20 of 21).                                                                                                                                 |
| 5. Out of scope         | Pass                            | Trees, a wind simulation and 3D: a plain answer saying it is not available yet, no number, no job (one model call each). No area: asks the user to draw one, no job. 5.8 km²: `422 agent_area_too_large` before the model, no turn stored. On both prompts, no unsupported or no-area answer contained an area size or count (8 answers).                                                                                                  |
| 6. Reopen a chat        | Pass                            | In the panel, with the area cleared and the map zoomed out to the city: opening a chat showed its transcript, restored its 0.44 km² area and fitted the map to it.                                                                                                                                                                                                                                                                         |
| 7. Ownership, accounts  | Pass                            | Ada on Alan's chat: `GET`, `PATCH`, `DELETE` and `POST …/messages` all `404`, and the chat is not in her list. Katherine (pending) can log in but asking answers `403`. Charles (disabled) cannot log in (`403 ACCOUNT_DISABLED`).                                                                                                                                                                                                         |
| 8. Busy and daily limit | Pass                            | Two simultaneous asks to one chat: one stream, one `409 agent_chat_busy`. Limit: Alan's counted `message` turns were padded to 99 with placeholder rows (removed afterwards) while he had two `job_update` turns; the 100th question was answered, the 101st got `429 agent_daily_limit`, and the rejected ask stored no turn.                                                                                                             |
| 9. Turn records         | Pass                            | Every turn stores tokens (input, output, cache read, cache write), cost, provider, model, prompt version, model calls, duration, outcome and job ids, including the background `job_update` turns (their triggering job).                                                                                                                                                                                                                  |

## Turn costs

26 Bedrock turns in this run cost **$0.069** in total.

| Turn                                                       | Cost           | Duration   |
| ---------------------------------------------------------- | -------------- | ---------- |
| Count question, job started or reused (2 model calls)      | $0.0013–0.0056 | 2.7–28.7 s |
| Background report of a finished job (`job_update`, 1 call) | $0.0010–0.0024 | 1.5–1.6 s  |
| Catalogue (2 calls, the longest answer)                    | $0.0121–0.0122 | 4.3–4.9 s  |
| Out of scope or no area (1 call)                           | $0.0009–0.0017 | 1.1–1.9 s  |

## Rerun after the fix round

`AGENT_JOB_WAIT_MS` is now 45 s by default, the package reader reads each package once, and the prompt
names no Dataset tool (version `2cf59bf42328`). Run as a new active user (Grace), so that no earlier
job for the area could be reused.

| Item               | Result | Notes                                                                                                                                                                                                                                                            |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Count, ~0.4 km² | Pass   | A fresh job for `[319370, 6397763, 319996, 6398458]` took 24.6 s, within the wait: **331** in the same turn (29.8 s, 2 model calls, $0.00562793). Package: 331 of 332. Asking again in the chat reused the job, with the status "Using an earlier City result…". |
| 2. Count, ~2 km²   | Pass   | A fresh job for `[319000, 6397440, 320415, 6398975]` took 75 s. The turn ended at 48 s saying the result would be posted (wait plus the model's reply); the watcher posted **1,288** 2 s after the job ended, read by the new reader.                            |

Peak RSS of the package reader on the sizing packages, measured as before (`/usr/bin/time -l` on a
script that reads one stored package the way a report does): 2 km², 1,208 buildings: **0.41 GB**
(0.87 GB before); 5 km², 3,296 buildings: **0.40 GB** (1.47 GB before), in 4.2 s.

## Findings

1. **Item 1 with a fresh job needed a longer wait.** On this Engine a fresh `city` job for 0.44 km²
   took 25–37 s, not the 12 s measured on 2026-11-07, so with the original 20 s wait it was answered by
   the watcher. The team set `AGENT_JOB_WAIT_MS` to 45 s; the rerun answered in the same turn.
2. **The panel showed Markdown literally** (`**1,288 buildings**`), because it renders answers as
   plain text. The system prompt now asks for plain text and `- ` lists; on the second pass no answer
   used Markdown. Rendering Markdown in the panel is the alternative, at the cost of a dependency.
3. A client that disconnects mid-turn: the turn is stored `failed` with `client_disconnected`, and the
   lock is released as the turn unwinds; an ask sent within the same second still got `409`, the next
   one ran.
4. Fixed in the fix round: the status line now says "Using an earlier City result…" for a reused job,
   and costs are stored rounded to 8 decimals. Answers still name "Phase 1", the only number in
   out-of-scope replies.

`ANTHROPIC_API_KEY` is not set in this worktree, so Task 13 Step 3 (the Anthropic API) was not run.

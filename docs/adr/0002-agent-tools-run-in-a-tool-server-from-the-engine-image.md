---
status: deferred
---

# Agent tools run in a tool server built from the Engine image

> **Deferred to phase 3 (2026-11-07).** Phase 1 has no tool server; see [the phase 1 design](../agent-migration/phase-1-design.md). This decision is reconsidered when phase 3 is planned.

The Agent's tools run in `dtcc-agent`'s tool server, ported into `apps/engine` without its simulation
and GeoJSON tools, and run as a third container from the Engine image beside the API and the
workers. It keeps what it does today: each Chat's Objects in memory, a disk cache for downloads,
builder operations, inspection, comparison, spatial queries, renders and exports, all in process. It
gains one tool, which loads a finished Engine job's package by job id. Simulations stay ordinary
user jobs, submitted by the backend's `jobs` service. Engine itself does not change.

The tool server speaks MCP over streamable HTTP, stateless, with SSE responses, as `dtcc-agent`
serves it today. Only the backend calls it, through the gateway, with Engine's token; the Chat's
Session and the turn travel in headers.

## Considered Options

- **Every tool that needs Core as an Engine job**, with results kept as Session-scoped packages on
  Engine (this ADR's first version, 2026-11-02). Rejected: Engine would need jobs tagged by Session,
  packages as job inputs and closing a Session, which its v1 design defers or excludes; six
  operations would first have to become Core Datasets; and `dtcc-agent`'s ADR-0011 measured answers
  30–38% slower when downloads ran as Engine jobs.
- **Tools inside the Engine API process.** Rejected: heavy Core work would share a process with
  request handling.
- **A separate image or repository for the tool server.** Rejected: Core would be pinned in two
  places. From the Engine image, one build argument pins Core for both, the layers are stored once
  per host, and the processes stay separate.
- **REST plus a skill instead of MCP.** Equal in Vasilis's test (2026-11-03). MCP kept: the tool
  definitions come from the server next to the code, the existing server is reused, and outside
  agents would use MCP later. Stateless MCP behaves like REST through the gateway (tested
  2026-11-03: restarts need no reconnect; long calls stay open through 15 s pings).

## Consequences

- Core runs in two processes from one pin: Engine's jobs and the tool server. Engine's pin
  (`17c6efe`) is 11 commits behind the tool server's (`a78df16`), so it moves forward first, and the
  two move together from then on.
- The tool server holds state outside Engine's queue, so it needs its own limits: concurrent calls,
  a memory budget for Objects with least-recently-used eviction, Sessions dropped after an hour idle,
  and a container memory limit. A restart loses every Session's Objects; Runs are loaded again by
  job id.
- Engine's token can read every job, and the tool server knows no users. The backend therefore
  checks that a job id is the user's own and belongs to the Chat before the tool server loads it.
- Downloads stay in process behind the disk cache for the first version. Engine jobs behind the same
  cache are possible later without changing Engine: on 2026-11-03 a fresh download as an Engine job
  cost about the same as one in process, and loading the package took 0.1–0.4 s.

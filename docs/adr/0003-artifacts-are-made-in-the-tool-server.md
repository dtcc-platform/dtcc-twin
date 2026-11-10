---
status: deferred
---

# Artifacts are made in the tool server and copied into the Chat

> **Deferred to phase 3 (2026-11-07).** Phase 1 has no tool server; see [the phase 1 design](../agent-migration/phase-1-design.md). This decision is reconsidered when phase 3 is planned.

A file the user sees or downloads, such as an exported mesh or a rendered image, is made by the tool
server, as today, in the calling Session's artifact folder. The tool result names it. The backend
fetches it from the tool server with Engine's token, checks its size and media type, stores it with
the Chat and serves it to the Chat's owner. We chose this over a folder shared between the tool
server and the backend, which `dtcc-agent` uses today, because the backend and the tool server may
run on different hosts.

## Consequences

- The tool server gets one read-only route for a Session's artifacts, behind the same token, with
  `dtcc-agent`'s path rules (`dtcc_agent/artifacts.py`): only names it wrote, no paths from outside.
- A file shown in a Chat is copied when it is shown, so it outlives the Session, and is deleted with
  the Chat.
- The backend reads with bounds of its own: a size cap checked while streaming, and only the media
  types the tools produce.

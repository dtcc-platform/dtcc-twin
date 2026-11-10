---
status: deferred
---

# Chats outlive Sessions; Runs are kept, Objects are not

> **Deferred to phase 3 (2026-11-07).** Phase 1 has no tool server; see [the phase 1 design](../agent-migration/phase-1-design.md). This decision is reconsidered when phase 3 is planned.

A Chat is kept for its User until 90 days after its last use, until the User deletes it, or until the
account is deleted; a disabled account keeps its Chats. Its Session, the tool server's live state for
the Chat, holding its Objects, ends after an hour without activity or when the tool server restarts.
Reopening a Chat starts a new Session: its earlier Objects no longer resolve. A Run is described from
its record, and its result, which is the user's own Engine job, is loaded into the new Session by job
id; if the package has expired, it is computed again. We chose this because Objects can be gigabytes
each, and keeping them for every saved Chat would cost more memory and storage than the occasional
recomputation.

`dtcc-agent` used "Session" for the whole conversation; here that is the Chat (see `CONTEXT.md`).
The isolation rule from `dtcc-agent`'s ADR-0004 carries over: nothing a Session holds is visible from
another, and a Run's result enters a Session only through a job id the backend has checked.

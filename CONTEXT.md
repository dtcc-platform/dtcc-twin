# DTCC Twin — domain glossary

Terms for the Agent, the conversational front door ported from `dtcc-agent` into this repository.
Terms carried over from `dtcc-agent/CONTEXT.md` keep their meaning unless a note says otherwise.

## Agent

> Phase 1 (2026-11-07) has no tool server: **Session**, **Tool server** and **Object** are phase 3 terms. In phase 1 a Chat's history is stored in the backend and each answer is a **turn** ([phase 1 design](docs/agent-migration/phase-1-design.md)).

**User**
A person signed in to Twin. Owns Chats.

**Chat**
A saved conversation between a User and the Agent: what the User asked and what the Agent
answered, kept until its retention ends or the User deletes it. A Chat can be reopened long after
it was last used.
_Avoid_: conversation (ambiguous), session (a different thing, below).

**Session**
The tool server's live working state for a Chat while it is in use: its Objects and its artifacts.
**The Session is the isolation unit**: nothing it holds is visible from another Session, and a Run's
result enters it only through a job id the backend has checked.
A Session ends after an hour without activity, or when the tool server restarts. Reopening a Chat
later starts a new Session, in which earlier Object references no longer resolve.
_Changed from `dtcc-agent`_: there a Session was the whole conversation. Here the conversation is
the Chat, and the Session is only its live state.

**Tool server**
`dtcc-agent`'s MCP server, ported into `apps/engine` and run as its own container from the Engine
image. It runs the Agent's tools that need Core, in process, and holds the Sessions. Only the backend
calls it.

**Object**
A value produced by an Operation and held in the tool server's memory for later reference within one
Session: a point cloud, a raster, a mesh, a building collection. Referred to by an **Object
reference**, never passed by value. An Object never outlives its Session.

**Artifact**
A file a User can see or download, such as an exported model or a rendered image. Made by the tool
server in a Session, and copied into the Chat once shown there.
_Avoid_: attachment, export file.

**Run**
One execution of a simulation, with the parameters it was given and the summary of its result.
It is the User's own Engine job. A Run's record belongs to the Chat and outlives the Session; its
result is loaded into a later Session by job id while Engine keeps the package.

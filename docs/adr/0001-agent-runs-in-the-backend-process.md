---
status: proposed
---

# The Agent runs inside the backend process

The Agent's conversation loop, limits and chat storage run as a module of the NestJS backend, in its
process, rather than as a separate app with its own credentials. We chose one deployable and one set
of conventions over credential isolation, knowing that a flaw reachable through the Agent reaches
everything the backend can: the database, `JWT_SECRET`, the Engine credential, the gateway admin
credential and the instance role.

dtcc-infra's design (`docs/design/agent.md`, "Migration into dtcc-twin", open question 1) requires
this boundary to be explicitly accepted before the Agent is enabled. This ADR stays `proposed` until
the operator accepts it.

## Considered Options

- **A second NestJS app from this repository** (`apps/agent`), in its own container with only a
  Bedrock grant, its own database login and a credential for the tool server. Isolates
  credentials; costs one more image and an internal route. Rejected for now in favour of a single
  deployable.
- **A module now, split before public access.** Rejected: splits like this are deferred in practice.

## Consequences

The decision is acceptable only with these rules, which reviews enforce:

- Every tool argument the model produces is validated before use: bounds, parameters, and Object
  references, which must belong to the calling Session. No SQL, file path or URL is built from model
  output.
- The Agent module reaches the database only through its own repositories, and other modules only
  through their exported services, never through user or job repositories.
- The instance role's Bedrock grant covers the one model the Agent uses.
- Provenance and logs never contain tokens, cookies or credentials.

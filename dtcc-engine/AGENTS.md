# AGENTS.md

These instructions apply to `dtcc-engine/` and its subdirectories. All `temp/`
paths and setup commands below are relative to the repository root.

## Keep DTCC Engine thin

- DTCC Engine exposes a thin API over `dtcc-core` and `dtcc-sim`. Keep its
  responsibilities limited to API request/response handling and coordination
  of Core and Sim capabilities, following [DESIGN.md](../DESIGN.md).
- Reuse `dtcc-core` and `dtcc-sim` wherever they provide the required behavior.
  Do not duplicate their data models, input/output, processing, or simulation
  logic in the engine.
- Reuse existing public APIs without unnecessary wrappers. This does not
  prescribe in-process imports or service calls; explain the chosen boundary
  when implementing an integration. Add a small adapter only when a concrete
  application requirement needs translation.

## Inspect before implementing

- Before implementing a task, inspect relevant code in both `temp/dtcc-core/`
  and `temp/dtcc-sim/` for reusable capabilities. Revisit it when requirements
  or assumptions change. Use implementations, tests, and examples to verify
  the APIs you need.
- Verify API names, arguments, return values, and contracts from source. Do not
  invent an API or assume that a design document describes implemented behavior.
- If a checkout is missing, use the setup commands below. If setup is blocked
  or the required behavior is unclear, report the gap and resolve it before
  writing code that depends on it.
- If a shared capability is missing, explain whether it belongs in Core or Sim
  before adding an engine implementation.
- Treat `temp/dtcc-core/` and `temp/dtcc-sim/` as reference checkouts during engine
  work. Propose upstream changes separately; do not modify these checkouts as
  part of an engine change.
- References to `dtcc-atlas` and `dtcc-tangible-twin` in upstream material
  describe earlier applications. Follow Twin's `DESIGN.md`; do not assume
  their layouts or compatibility requirements apply here.

The reference checkouts are ignored by Git. From the repository root, clone
only missing checkouts, using the `develop` branch:

```sh
mkdir -p temp
git clone --branch develop git@github.com:dtcc-platform/dtcc-core.git temp/dtcc-core
git clone --branch develop git@github.com:dtcc-platform/dtcc-sim.git temp/dtcc-sim
```

## Prefer simple, modular code

- Write straightforward Python for the engine. Keep API handlers small and
  delegate domain work to Core and Sim.
- Write the minimum code needed for the current requirement. Keep functions
  focused and group related behavior in cohesive modules with clear inputs and
  outputs. Do not split code merely to create more files or layers.
- Prefer ordinary functions, explicit control flow, and standard data structures.
  Use classes and abstractions only when they make the current code simpler.
- Add abstractions, wrappers, configuration options, and dependencies only when
  needed for the current requirement. Avoid speculative frameworks and defensive
  code for impossible cases.
- When code in the engine, Core, or Sim appears overengineered, identify the
  concrete complexity and propose a cleaner solution that preserves required
  behavior and contracts. Reuse capabilities without copying unnecessary
  complexity.
- Apply simplifications within the requested scope. Report unrelated cleanup
  opportunities without expanding the change into an unsolicited refactor.

## Write clearly and document properly

- Use descriptive names and straightforward code. Avoid cryptic abbreviations,
  clever shorthand, dense expressions, and implicit tricks.
- Write comments, docstrings, and documentation in formal, precise English,
  without slang or unexplained jargon.
- Document public modules, classes, and functions concisely, using docstrings
  for Python code. Explain purpose, inputs, outputs, and relevant constraints;
  include units, coordinate conventions, side effects, and raised exceptions
  where applicable.
- Explain non-obvious decisions in comments rather than restating the code.
  Keep documentation accurate when behavior changes.

## Keep changes focused and verifiable

- State assumptions and meaningful tradeoffs before implementation. If a
  requirement is ambiguous, name the uncertainty and ask rather than guessing.
- For multi-step work, give a brief plan with a verifiable outcome for each step.
- Match existing conventions unless they conflict with these instructions;
  explain any necessary departure. Avoid unrelated formatting and refactoring.
- Remove imports, variables, and helpers that your changes make unused. Leave
  unrelated existing dead code alone. Every changed line should serve the
  requested task.
- Verify the affected behavior with appropriate checks. For bug fixes, reproduce
  the failure and add a regression test where practical.
- Evaluate review feedback independently; state agreement or disagreement and
  the reason before implementing a suggestion.
- Report what changed and distinguish checks that passed, failed, were skipped,
  or were not run. Explicitly identify incomplete work and verification limits.
- Use commit messages in the form `Type: Subject`, with a capitalized type and
  sentence-case subject, for example `Fix: Reuse Core data validation`.
- Do not add "Generated with" attributions to Codex CLI or Claude Code in GitHub
  pull requests.

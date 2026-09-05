# DTCC Twin instructions

These instructions apply throughout the repository.

Before planning or making changes under `dtcc-engine/`, read and follow
[dtcc-engine/AGENTS.md](dtcc-engine/AGENTS.md).

The linked engine instructions apply only to `dtcc-engine/` and its subdirectories.

## Write clearly and document properly

- Use descriptive names and straightforward code. Avoid cryptic abbreviations,
  clever shorthand, dense expressions, and implicit tricks.
- Write comments, docstrings, and documentation in formal, precise English,
  without slang or unexplained jargon.
- Document public modules, classes, and functions concisely. Explain purpose,
  inputs, outputs, and relevant constraints; include units, coordinate
  conventions, side effects, and raised exceptions where applicable.
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
- Do not add AI-generated attribution, AI co-author trailers, or agent session
  links to commit messages or pull requests.

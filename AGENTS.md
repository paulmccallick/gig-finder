# Codex Project Guide

Read the relevant files in `docs/product/` and `docs/architecture/` before
changing behavior or contracts. Update them in the same change. If code and
documentation conflict, stop and flag it.

The backlog is the [GigFinder GitHub
Project](https://github.com/users/paulmccallick/projects/5).

## GitHub workflow

The GitHub Project is the workflow source of truth. Statuses are Backlog
(unrefined), Grooming (requirements being refined), Development
(implementation or verification underway), and Done (closed and hidden).
Before grooming, developing, or closing an issue, ask the user whether to move
it to the matching status. Create branches from `main` and link each pull
request with `Closes #<issue>`. Changes to `main` must arrive through pull
requests. Merging a linked pull request closes the issue; GitHub automation
sets Done and the board hides it. Do not use labels as workflow statuses.

## Development rules

- Use Bun for package management, scripts, and tests.
- Use the ignored repository-local `tmp/` directory for temporary files; do
  not use `/private/tmp`.
- Never add real personal information, credentials, job-search records,
  documents, logs, SQLite files, or backups to this repository.
- Use synthetic fixtures in tests and examples.
- Add regression tests for changed documented behavior.
- Run `bun run check` and `bun run build` for application changes.
- Run `bun run test:e2e` for dashboard behavior changes.
- Definition of done: all required checks pass, and any issues found by those
  checks are fixed as part of the change.
- Limit scope to the requested feature
- Apply SOLID principles
- Be pragmatic - avoid unecessary obfuscation
- Treat TypeScript types as executable design constraints: flag unchecked
  external data, unjustified `any` or assertions, incomplete union handling,
  and public types that permit impossible states.

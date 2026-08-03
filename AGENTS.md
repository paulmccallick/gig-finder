# Codex Project Guide

Read the relevant files in `docs/product/` and `docs/architecture/` before
changing behavior or contracts. Update them in the same change. If code and
documentation conflict, stop and flag it.

The backlog is the [GigFinder GitHub
Project](https://github.com/users/paulmccallick/projects/5).

## GitHub workflow

- The GitHub Project is the workflow source of truth for issue defintion and status.
- Statuses are backlog, grooming, development, and done
  - grroming means issue details and implementation are being defined
  - development meands it is currently in progress
  - done means the user has signed off on the issue
- move issues to the correct status when working with the user
- always create a feature branch when working on an issue.
- always create a PR when done with the development of an issue

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

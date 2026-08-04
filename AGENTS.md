# Codex Project Guide

Read the relevant files in `docs/product/` and `docs/architecture/` before
changing behavior or contracts. Update them in the same change. If code and
documentation conflict, stop and flag it.

The backlog is the [GigFinder GitHub
Project](https://github.com/users/paulmccallick/projects/5).

## GitHub workflow

The GitHub Project is the source of truth. Use Backlog for unrefined work,
Grooming while defining requirements, Development while implementing or
verifying, and Done only after user sign-off. Ask before moving an issue to its
next status. Create feature branches from `main`; changes to `main` require a
pull request linked with `Closes #<issue>`. A merge closes the issue and hides
it from the board. Production changes are done only after their merge image is
published, deployed locally, and verified.

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
- Definition of done: required checks pass, their findings are fixed, and
  production-affecting changes are published, deployed, and verified.
- Limit scope to the requested feature
- Apply SOLID principles
- Be pragmatic - avoid unecessary obfuscation

# Codex Project Guide

Read the relevant files in `docs/product/` and `docs/architecture/` before
changing behavior or contracts. Update them in the same change. If code and
documentation conflict, stop and flag it.

The backlog is the [Job Search Agent GitHub
Project](https://github.com/users/paulmccallick/projects/5).

## Development rules

- Use Bun for package management, scripts, and tests.
- Never add real personal information, credentials, job-search records,
  documents, logs, SQLite files, or backups to this repository.
- Use synthetic fixtures in tests and examples.
- Add regression tests for changed documented behavior.
- Run `bun run typecheck`, `bun test`, and `bun run build` for application
  changes. Run `bun run test:e2e` for dashboard behavior changes.
- Limit scope to the requested feature
- Apply SOLID principles
- Be pragmatic - avoid unecessary obfuscation
- Treat TypeScript types as executable design constraints: flag unchecked
  external data, unjustified `any` or assertions, incomplete union handling,
  and public types that permit impossible states.

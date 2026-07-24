# Codex Project Guide

This repository contains a generic, local-first job-search agent application.
User profiles, job-search records, documents, logs, backups, and other private
context belong outside application source control.

## Project layout

- `src/core/`: domain models, ports, and application services.
- `src/sqlite/`: SQLite persistence, migrations, and context path resolution.
- `src/cli/`: command-line input adaptation.
- `src/agent/`: agent instructions, profile schema, and model runtime.
- `src/web/`: Bun HTTP API and Vite/React dashboard.
- `context/`: ignored local user workspace and, optionally, an independent
  private Git repository.

## Development rules

- Use Bun for package management, scripts, and tests.
- Keep HTTP concerns in `src/web`, domain behavior in `src/core`, and SQLite
  details in `src/sqlite`.
- Access operational state through application services rather than direct SQL.
- Never add real personal information, credentials, job-search records,
  documents, logs, SQLite files, or backups to this repository.
- Use synthetic fixtures in tests and examples.
- Preserve the separation between generic agent policy and user-provided
  context.
- Run `bun run typecheck`, `bun test`, and `bun run build` for application
  changes. Run `bun run test:e2e` for dashboard behavior changes.

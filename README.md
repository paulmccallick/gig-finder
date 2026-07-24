# Job Search Agent

A local-first job-search operating system with a React dashboard, Bun API,
SQLite tracker, command-line interface, and an AI SDK-powered agent panel.

The application is deliberately separate from each user's private context.
Source code lives in this repository; profiles, documents, operational data,
logs, and database backups live in a local `context/` workspace that is ignored
by Git.

## Requirements

- [Bun](https://bun.sh/)
- An OpenAI-compatible model configuration supported by the application

## Development

```bash
bun install
bun run dev
```

Open <http://127.0.0.1:5173/>.

Useful checks:

```bash
bun run typecheck
bun test
bun run build
bun run test:e2e
```

## Private context

By default the application resolves private state from `./context`. Set
`JOB_SEARCH_CONTEXT_ROOT` to use a workspace elsewhere.

The workspace can configure:

- Candidate and search profile.
- SQLite tracker database.
- Job descriptions and preparation documents.
- Logs and verified database backups.
- Private, locally exposed agent skills.

Never commit a real context workspace to the application repository. SQLite is
a binary database format and should use the application's verified backup and
restore strategy rather than source control.

## Architecture

- `src/core/` contains the application domain and service boundaries.
- `src/sqlite/` contains SQLite adapters, migrations, and context resolution.
- `src/cli/` adapts CLI commands to the shared services.
- `src/agent/` contains JobSearchAgent grounding and model interaction.
- `src/web/` contains the Bun API and Vite/React dashboard.
- `docs/` contains generic application design notes.

## Status

This project is under active development. The dashboard and tracker are
functional; agent memory, retrieval, and write-capable tools remain planned.

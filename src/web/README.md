# Job Search Control Room

Read-only React SPA for jobs, networking, and tasks. The Bun API composes the
shared services from `src/core` with adapters from `src/sqlite`; the
browser never reads SQLite or repository files directly.

```sh
bun run dev
```

Open <http://127.0.0.1:5173/>. The API serves current domain models from
`data/job-search.sqlite` and job descriptions from canonical artifact paths.

## JobSearchAgent

The dashboard includes a session-only JobSearchAgent panel. Its server-side
policy is generic to job searching, while the current user's targets,
strengths, constraints, and decision rules are supplied separately through
`context/job-search-profile.ts`.

`POST /api/agent/messages` accepts Vercel AI SDK UI messages and returns a UI
message stream backed by the local Codex subscription. Run `codex login` before
using the live agent. The browser never receives the Codex access token or
ChatGPT account identifier.

## Server logging

The API writes structured JSON logs through Pino. Debug logging is enabled by
default and records HTTP request metadata without request bodies. Agent calls
emit correlated start and completion events with model/provider identity,
latency, finish reason, and input/output/total token usage.

Logs are written to the gitignored `logs/server.log` and echoed to stdout.
The active file rotates at 10 MB, with at most five log files retained.

Set `LOG_LEVEL` to override the default, for example:

```sh
LOG_LEVEL=info bun run dev
```

The agent remains session-only and read-only:

- It can retrieve current jobs, networking contacts, and tasks through six
  bounded, server-side tools.
- Tool inputs use strict schemas derived from the domain enums, and list tools
  support inclusion, exclusion, search, ordering, and pagination.
- It cannot mutate tracker data or external systems.
- It cannot read meetings, history, documents, email, calendar, files, or
  external services.
- Messages remain only in React state and disappear on page reload.
- Durable memory, workflows, broader context retrieval, and write tools are
  separate backlog items.

```sh
bun run typecheck
bun test
bun run build
bun run test:e2e
```

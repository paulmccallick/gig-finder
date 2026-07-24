# SQLite adapters

This package implements the persistence and local-artifact ports defined by
`src/core`. It owns the Drizzle schema, checked-in migrations, audited
repositories, database maintenance, and deterministic artifact paths.

Application behavior belongs in `src/core`; consumers should use its
services rather than importing repositories directly.

```sh
bun run db:generate -- --name=descriptive_name
bun run db:check
bun run test:sqlite
```

The operational database is `data/job-search.sqlite`. Reads hide soft-deleted
records by default. Updates preserve complete prior snapshots and associate
business events with an audited change envelope.

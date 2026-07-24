# Job Search CLI

The command-line interface is the writable UI for the job-search system. It
validates command input, then delegates all business behavior to the services in
`src/core`. SQLite and artifact access are composed in `src/db-store.ts`.

Run it from the repository root:

```sh
bin/job-search jobs list
bin/job-search networking list
bin/job-search tasks list
bin/job-search artifacts verify
```

Use `--dry-run` for mutations that support it and `--patch-file` for structured
or sensitive updates. The CLI must not implement business rules or write SQL.

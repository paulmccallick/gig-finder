# Architecture boundaries

- Domain behavior and validation belong in `src/core`.
- HTTP parsing, status codes, and streaming belong in `src/web`.
- Uploaded binaries and format conversion remain in `src/web`; core receives
  only Markdown and validated provenance.
- SQL, migrations, repositories, and filesystem artifacts belong in
  `src/sqlite`.
- CLI and browser dashboard code depend only on core application contracts;
  they do not construct or import SQLite adapters.
- Agent tools and the CLI use the same domain services; caller-specific
  metadata stays in their adapters.
- Filtering, joins, traversal, ordering, pagination, and consistency checks
  belong to caller-neutral core read services, not agent tools.
- Meeting services compose participant IDs from the persistence join records
  and validate participant and optional job references.
- Core services attach the same compact managed-document summaries to job and
  networking-contact reads for CLI, agent, and web clients.
- Generic agent policy is separate from the user profile, which defaults to
  `context/`.
- Private context never belongs in application source control.

# Architecture boundaries

- Domain behavior and validation belong in `src/core`.
- HTTP parsing, status codes, and streaming belong in `src/web`.
- Uploaded binaries and format conversion remain in `src/web`; core receives
  only Markdown and validated provenance.
- SQL, migrations, repositories, and filesystem artifacts belong in
  `src/sqlite`.
- CLI and web code call application services; they do not query SQLite.
- Agent tools and the CLI use the same domain services; caller-specific
  metadata stays in their adapters.
- Core services attach the same compact managed-document summaries to job and
  networking-contact reads for CLI, agent, and web clients.
- Generic agent policy is separate from the user profile, which defaults to
  `context/`.
- Private context never belongs in application source control.

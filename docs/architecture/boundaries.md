# Architecture boundaries

- Domain behavior and validation belong in `src/core`.
- HTTP parsing, status codes, and streaming belong in `src/web`.
- Uploaded binaries and format conversion remain in `src/web`; core receives
  only Markdown and validated provenance.
- SQL, migrations, repositories, and filesystem artifacts belong in
  `src/data`.
- CLI and browser dashboard code depend only on core application contracts;
  they do not construct or import data adapters.
- Agent tools and the CLI use the same domain services; caller-specific
  metadata stays in their adapters.
- The task service validates Gig and Person links, derives relationship labels,
  and owns creation defaults, Pacific business dates, and status transitions for
  every client.
- Filtering, joins, traversal, ordering, pagination, and consistency checks
  belong to caller-neutral core read services, not agent tools.
- Meeting services compose participant IDs from the persistence join records;
  validate participant, timestamp, and optional gig references; and update the
  Meeting and its participant rows in one change transaction. Participant-only
  changes advance the Meeting revision and remain reversible through generic
  history.
- Core services attach the same compact managed-document summaries to gig and
  person reads for CLI, agent, and web clients.
- Core owns Profile-document relationships, names, descriptions, and versions;
  data materializes current Markdown beneath the configured private directory
  and retains failed writes as pending without replaying the domain change.
- Generic agent policy is separate from the user profile, which defaults to
  `context/`.
- Core owns the supported agent-model catalog and preference validation; web
  owns its HTTP contract and control, while data stores only generic key/value
  settings.
- Private context never belongs in application source control.

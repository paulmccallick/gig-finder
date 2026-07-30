# Architecture boundaries

- Domain behavior and validation belong in `src/core`.
- HTTP parsing, status codes, and streaming belong in `src/web`.
- SQL, migrations, repositories, and filesystem artifacts belong in
  `src/sqlite`.
- CLI and browser dashboard code depend only on core application contracts;
  they do not construct or import SQLite adapters.
- Agent tools and the CLI use the same domain services; caller-specific
  metadata stays in their adapters.
- Generic agent policy is separate from the user profile, which defaults to
  `context/`.
- Private context never belongs in application source control.

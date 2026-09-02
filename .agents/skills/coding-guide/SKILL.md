---
name: coding-guide
description: Apply GigFinder development, testing, scope, privacy, and design rules. Use whenever implementing, modifying, testing, or reviewing application code, behavior, contracts, migrations, or documentation.
---

## Development rules

- Use Bun for package management, scripts, and tests.
- Use the ignored repository-local `tmp/` directory for temporary files; do
  not use `/private/tmp`.
- Never add real personal information, credentials, job-search records,
  documents, logs, SQLite files, or backups to source control. Development
  context belongs in ignored `context/`; production state uses standard Unix
  paths under `/var` and `/etc`.
- Use synthetic fixtures in tests and examples.
- Add regression tests for changed documented behavior.
- Run `bun run check` and `bun run build` for application changes.
- Run `bun run test:e2e` for dashboard behavior changes.
- Definition of done: required checks pass, their findings are fixed, and
  production-affecting changes are published, deployed, and verified.
- Limit scope to the requested feature
- Apply SOLID principles
- Be pragmatic - avoid unecessary obfuscation
- Do not create automated tests to verify the deprecation of features or old implementations.
- typescript should be human readable, not minimized
- json should be human readable, not minimized
- avoid creating new paths for existing capabilities. Prefer code re-use.

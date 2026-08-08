# ADR 0009: Keep personal data out of source control

**Status:** Accepted
**Date:** 2026-08-06

## Context

GigFinder operates on private job-search data, including people, employers,
positions, communications, documents, and activity history. Application code,
tests, examples, migrations, logs, and generated artifacts can unintentionally
copy that data into Git history, where deletion is difficult and public release
may expose it permanently.

## Decision

Git-tracked files contain no data sourced from a user's actual job search.
Prohibited data includes real or pseudonymized people, companies, positions,
applications, interactions, event identifiers or summaries, documents,
messages, profile content, URLs, database records, logs, credentials, and
derived combinations that could identify those records.

This boundary applies to source code, configuration defaults, migrations,
fixtures, tests, examples, snapshots, documentation, generated files, build
contexts, and release artifacts. Replacing a name with an internal identifier
does not make a production record suitable for source control.

Tests and examples use intentionally synthetic fixtures that are not adapted
from private records. Generic domain language such as “Example Company” or
“Director of Engineering” is allowed when it does not reproduce an actual
record.

Private operational data lives only in ignored local context directories or
external production state. One-time rollout inputs and generated commands stay
ignored, are validated before use, and are never copied into committed
migrations. Before committing data-related changes, the staged diff is checked
for private values and unintended tracked files.

## Consequences

- The public repository and its history remain free of personal job-search
  data.
- Migrations and tests must express generic behavior with synthetic fixtures.
- One-time data conversion may require ignored local artifacts and an
  operator-run validation step.
- Private data cannot be used as a convenient committed regression fixture.

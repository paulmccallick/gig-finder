# ADR 0006: Make database document state authoritative

**Status:** Accepted
**Date:** 2026-08-05

## Context

Managed documents need transactional ownership, metadata, and immutable version
history. Some content also exists as human-readable filesystem files. SQLite
and the filesystem cannot participate in one atomic transaction, so treating
both as authoritative would make failure recovery ambiguous.

## Decision

SQLite is authoritative for managed-document identity, ownership links,
metadata, content, current version, and immutable prior versions.

Filesystem copies are source imports or derived projections:

- Importers validate and copy source content into an audited managed-document
  version without making the source path part of managed state.
- Materializers write projections atomically where possible and record the
  materialized database version.
- A failed projection leaves the committed document pending for idempotent
  repair; it does not replay or roll back the domain mutation.
- Readers that require authoritative content use the document repository.
- Rollout importers use deterministic identities, content equivalence, and an
  audited idempotency boundary. Source files may remain temporarily for
  rollback, but discovery prefers equivalent managed content.

## Consequences

- Document links and versions remain transactionally consistent.
- Projection drift is detectable and repairable.
- Import retries cannot duplicate equivalent managed content.
- Operators must monitor failed materialization and import diagnostics.

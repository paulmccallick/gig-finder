# ADR 0005: Store mutations as revisioned, audited transactions

## Context

GigFinder must preserve current state while explaining how it changed, prevent
lost updates, group related writes, and safely reverse eligible changes. An
updated timestamp or untyped audit log cannot provide those guarantees across
entities and relationships.

## Decision

- Every mutable live row carries a revision, deletion state, and timestamps.
  Updates require the expected revision and increment it atomically. Deletion
  is a versioned soft delete.
- Each mutable table has a typed history table containing the prior complete
  row, operation, revision, actor, time, and change ID. Reversible creations
  also record creation history where supported.
- A `changes` row is the audit envelope for one domain operation. Every entity,
  relationship, history, and evidence write in that operation shares its
  change ID and commits in one SQLite transaction.
- Reverting a change creates a new audited change. It restores only supported
  state and rejects the revert if a later revision or dependent record would
  be overwritten or orphaned.
- Domain activity records may be associated with a change, but their domain
  model is independent of storage-level history. This ADR does not choose a
  particular activity entity or schema.

## Consequences

- Current-state queries remain direct while typed snapshots support inspection
  and bounded reversal.
- Multi-record operations commit completely or roll back completely under one
  audit identity.
- Adding a mutable entity requires explicit live, history, and transaction
  mappings. This duplication is accepted in exchange for typed, queryable
  history.
- History growth requires backup and retention planning.

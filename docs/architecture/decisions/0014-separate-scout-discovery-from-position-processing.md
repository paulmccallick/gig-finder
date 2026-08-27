# ADR 0014: Separate Scout discovery from position processing

**Status:** Accepted
**Date:** 2026-08-20

## Context

Scout currently processes one company per BunQueue job and persists logical
positions with per-run observations. Existing persistence already deduplicates
positions across runs and remains the authoritative identity boundary.

Gig reconciliation, description retrieval, and agent screening operate on a
logical position, not a company scan or observation. They need independent
retry and recovery without delaying or failing discovery. Their processing
progress must also remain separate from user-facing position state.

## Decision

Split Scout into two durable job boundaries:

- **Company discovery:** Keep the existing company queue and position upsert.
  A successful company job persists positions and observations, then
  `ScoutRunService` requests required tracked-position availability changes
  from the Gig domain before marking the company result complete. It creates
  downstream position work without waiting for position processing.
- **Position processing:** Add a separate BunQueue whose jobs process one
  logical position and stage. The initial stage is `reconcile_gig`; #121 may
  add description retrieval and agent review.

Store durable stage progress in `scout_position_processing`, keyed by position,
stage, and stage-specific input identity. Its statuses are `pending`,
`completed`, `failed`, and `superseded`. Use an outbox and deterministic job ID
to bridge committed work to queue submission and recovery.

GigFinder's database remains authoritative for processing results and terminal
failures. BunQueue owns transient execution state, retries, backoff, and
leases. User-facing position state is stored separately and changes only when
a processing result or audited user action requires it.

## Alternatives considered

- **Process everything in the company job:** rejected because downstream work
  has different failure, retry, and concurrency boundaries.
- **Process every observation:** rejected because processing belongs to the
  existing logical position and relevant input revision.
- **Use queue or user-facing state as durable progress:** rejected because
  transport state, processing progress, and user workflow have different
  lifecycles.

## Consequences

- Existing position identity and observation deduplication remain unchanged.
- Company scans finish independently of position-processing failures.
- Position stages are idempotent, recoverable, and extensible for #121.
- Operations must configure, monitor, drain, and recover two embedded queue job
  types under ADR 0010's single-owner constraint.

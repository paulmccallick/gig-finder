# ADR 0010: Use BunQueue for durable background work

**Status:** Accepted
**Date:** 2026-08-11

## Context

Gig Scout scans many external career sources. A full run can outlive the HTTP
request and browser session that started it, and individual company scans can
fail, time out, or require retry because scraping is inherently brittle.
Running this work in a request handler or an in-memory task would lose progress
on disconnect or application restart and would not provide a reliable boundary
for concurrency, retry, or recovery.

GigFinder is deployed as a single Bun application on one host and already uses
SQLite-backed external state. Adding a separately operated Redis service is not
justified for this workload.

## Decision

Use BunQueue in embedded, persisted mode for Gig Scout and future background
work that is single-host, idempotent, bounded in payload size, and able to keep
its authoritative outcome outside the queue. Pin the BunQueue version and
verify its embedded persistence, bulk enqueue, concurrency, retry, stall, and
restart behavior against GigFinder's Bun version before release.

- Exactly one production application process owns the BunQueue data file.
  Secondary servers, tests, CLI processes, and smoke runs use isolated queue
  files and never open the production file concurrently. Deployment prevents
  overlapping owners; opening the production path from a second process is
  unsupported and must fail startup or deployment verification.
- A Gig Scout company scan is one independently retryable job. Jobs are added
  in bulk, pulled in configurable batches, and processed with bounded worker
  concurrency.
- Job payloads contain the immutable company configuration needed to execute
  the scan. Large scan results and job-description content are never returned
  through or persisted in the queue.
- BunQueue owns transient job state, bounded retries, backoff, leases, stall
  recovery, and exhausted-job handling. Workers do not write a transient
  `running` state to the GigFinder database. Retry exhaustion is projected into
  a terminal, operator-visible company and run outcome before queue state may
  be discarded, so reconstruction cannot silently reset the retry budget.
- GigFinder's database remains authoritative for run identity, configuration
  versions, durable progress, diagnostics, and terminal outcomes. Description
  content is written to its private artifact store and referenced by database
  metadata.
- A durable database outbox and deterministic job identifiers bridge run
  creation to queue submission. The run, run-company records, immutable
  configuration references, and outbox rows are committed in one transaction.
  A job ID is derived from the run-company ID, and reconstruction resolves the
  same immutable configuration version. Worker result and run-finalization
  writes share an idempotent database transaction so enqueue retry, redelivery,
  or recovery cannot duplicate logical results.
- Application startup reconciles pending outbox work and nonterminal company
  records using deterministic job IDs. Shutdown stops pulling new work and
  allows in-flight handlers to drain; interrupted handlers are eligible for
  lease expiry and redelivery, so their external and persistence effects remain
  idempotent.
- The queue database is reconstructable transport state, not domain backup
  authority. Restore GigFinder's database and artifacts first, quarantine stale
  queue state, and rebuild jobs from nonterminal records.

Here, durable means acknowledged queue state survives application or container
restart on the same healthy data volume. It does not protect against host,
volume, or disk loss; external backup and restore provide that recovery.
Description files are written atomically under content-addressed paths before
their metadata transaction. A database failure may leave an unreferenced file,
which verification detects and maintenance may remove; it must not leave a
database reference to missing content.

The BunQueue workflow engine does not define Gig Scout's business process.
Core application services continue to own run lifecycle, validation,
finalization, and user-visible contracts.

## Alternatives considered

- **Run scans inside the initiating HTTP request:** rejected because work would
  be coupled to request timeouts, disconnects, and browser lifetime.
- **Use in-memory promises or timers:** rejected because queued and active work
  would be lost on restart and retry/recovery behavior would be ad hoc.
- **Build a custom SQLite polling queue:** rejected because it would duplicate
  established queue concerns such as leasing, backoff, concurrency, and stalled
  job recovery.
- **Use Redis with BullMQ:** deferred because it adds an external stateful
  service without a current multi-host or throughput requirement. Revisit if
  GigFinder needs clustered workers or queue failover.

## Consequences

- Long-running scans continue independently of the initiating request and can
  recover after application restart.
- Company failures and retries are isolated, while concurrency protects the
  host and external sources.
- Queue handlers and database writes must remain idempotent because delivery is
  not an exactly-once transaction with GigFinder's database.
- Production must preserve a single-owner topology for the embedded queue file
  and monitor waiting age, queue growth, exhausted or stalled work,
  reconciliation failures, and disk capacity. Completed-job retention and
  compaction require explicit operational limits.
- Backup and rollback procedures must treat queue data as reconstructable and
  keep authoritative database and artifact state coordinated.
- Moving to multiple application hosts would require revisiting this decision
  and likely adopting a network queue service.

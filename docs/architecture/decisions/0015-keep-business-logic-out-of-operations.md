# ADR 0015: Keep business logic out of operations

**Status:** Accepted
**Date:** 2026-08-20

## Context

`src/operations/` owns executable workflow infrastructure such as queue
runtimes, recovery, maintenance, and deployment. Putting domain decisions in
these handlers would make behavior depend on its delivery mechanism and harder
to reuse or test.

## Decision

`src/operations/` coordinates work but contains no business logic. It may
dispatch minimal durable references, load work, invoke application
capabilities, manage retries and recovery, log outcomes, and control process
lifecycle.

Domain rules, validation, and state transitions belong in `src/core/`.
Model-facing schemas and prompt adaptation belong in `src/agent/`. Queue
handlers must delegate those responsibilities rather than implement them.

## Consequences

- Queue payloads remain small and authoritative state remains durable.
- The same behavior can be invoked outside BunQueue and tested independently.
- Operations tests cover coordination and recovery, not domain policy.

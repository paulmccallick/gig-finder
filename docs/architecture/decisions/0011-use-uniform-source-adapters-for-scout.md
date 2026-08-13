# ADR 0011: Structure Scout as a core capability with uniform adapters

**Status:** Accepted
**Date:** 2026-08-12

## Context

Scout has two complexities - orchestrating searches across a large number
of target comnpanies and the wide variety of career sites that it must parse.
The code base contained many branches of logic to handle all of the company variations.

## Decision

Place Scout under `src/core/scout` with the followign layout.

```text
core/scout/
├── engine/
└── sourcing/
    └── adapters/
```

- `engine` orchestrates searches, including cancellation, retries, reconciliation,
  and outcome rollup.
- `sourcing` acquires and validates jobs from a wide variety of career sites
- `sourcing/adapters` contains one adapter for each type of site with each adapter extending the common `SourceAdapter` interface

Sourcing may not depend on engine. Concrete queue, SQLite, filesystem, web, and
UI implementations remain outside Scout core.
DOM selector extraction is preferred over regex extraction of HTML.

## Consequences

Scout is discoverable as one core capability while its engine stays reusable
and testable. New methods implement the common contract; new platforms implement
the vendor boundary. Generic repairs can be validated across every affected
company without company-specific production branches.

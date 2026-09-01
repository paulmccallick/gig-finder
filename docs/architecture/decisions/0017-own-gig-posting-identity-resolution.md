# ADR 0017: Own Gig posting identity resolution in the Gig domain

**Status:** Accepted
**Date:** 2026-09-01

## Context

Scout can encounter multiple current Gigs with overlapping posting evidence.
Applying different identity rules in Scout and the Gig domain can select or
reject a Gig inconsistently and bypass Gig-owned history and validation.

## Decision

- Each Gig has one current official-posting identity: normalized company plus
  its current nonblank requisition ID.
- Prior company, requisition-ID, and official-URL values remain in
  `gig_history` for reference only and are excluded from candidate matching.
- `GigDomainService` owns candidate resolution and acceptance of an official
  posting into a new or confirmed existing Gig.
- `ScoutPositionService` owns orchestration of the reviewed resolution,
  promotion, and managed job description.

## Consequences

Scout does not reproduce Gig matching or posting-application rules. Historical
identity evidence remains auditable without affecting a later resolution.

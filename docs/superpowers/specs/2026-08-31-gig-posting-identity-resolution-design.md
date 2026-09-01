# Gig Posting Identity Resolution

**Issue:** [#146 — Support multiple Gigs with the same company and title](https://github.com/paulmccallick/gig-finder/issues/146)

## Problem

GigFinder currently applies different identity rules at two points in the Scout
workflow. Scout reconciliation compares exact official posting identities, but
`GigDomainService.createNew` also treats normalized company and title as a
duplicate. A reviewed position can therefore be correctly distinguished from
an existing Gig and still fail promotion because the two requisitions share a
title.

The observed Visa example is:

- Scout position `REF078975W`, Director, Software Engineering; and
- existing Gig `REF084743W`, Director, Software Engineering.

They are distinct requisitions. The title match is useful evidence for a human
comparison, but it is not identity.

## Goals

This change will:

- permit multiple Gigs with the same normalized company and title;
- make normalized company plus normalized requisition ID the preferred posting
  identity evidence;
- preserve the original company and requisition-ID display values;
- require user confirmation before any candidate Gig is linked or updated;
- create a new Gig immediately after Pursue when no candidates exist;
- make missing-ID and other fallback matches advisory rather than automatic;
- pass the complete normalized posting into the Gig domain;
- update a confirmed existing Gig from the posting without changing its
  pipeline-owned state;
- preserve prior Gig identity values through existing audited revision history;
- place each core domain-service implementation in an explicitly named,
  single-service module; and
- keep promotion and managed-document work durable and idempotent.

## Non-goals

- No table of multiple active or historical Gig identities will be added.
- Historical identifiers will not participate in matching.
- Company aliases and fuzzy company matching are out of scope.
- Agent and CLI clients will not gain an interactive identity-resolution flow.
- Production verification against the private Visa records is not required;
  automated coverage will use synthetic records.

## Posting contract

Scout already represents an official posting as `NormalizedPosition`. Add the
company display name to that existing domain object. Do not add a
parallel `JobPosting`, promotion DTO, or field-by-field Gig mutation contract.

The complete `NormalizedPosition` passed to the Gig domain contains the
company, title, requisition ID, canonical official URL, display and structured
locations, work arrangement, normalized Markdown description, source identity,
and bounded source details. Persistence reconstructs it from the exact reviewed
observation and description. `ScoutPositionDetail` remains a read model that
combines posting data with Scout workflow and diagnostic state; it is not a
write contract.

If a source does not supply a posting attribute, accepting the posting does not
clear the corresponding current Gig field.

## Identity and candidate rules

Comparison preserves original values but normalizes company and requisition ID
by trimming whitespace and comparing case-insensitively.

Candidate evidence is deterministic:

1. An exact candidate has the same normalized company and the same nonblank
   normalized requisition ID.
2. An advisory candidate has the same normalized company and either an exact
   normalized title or exact canonical official URL.
3. Location, work arrangement, pipeline state, availability, last activity,
   and job descriptions are comparison information. They do not independently
   create a candidate or identity match.

Careers platform, Scout template, source key, and official URL are supporting
reference data, not components of identity. A company that retains a
requisition ID while changing recruiting systems still produces the same exact
candidate.

No candidate is linked automatically. An active Gig with an exact requisition
ID, a closed Gig with an exact requisition ID, and one or more advisory matches
all require user confirmation. If no candidates exist, the user's Pursue action
is sufficient confirmation and Gig creation proceeds without another prompt.

The same company and requisition ID may appear on more than one Gig only after
the user explicitly chooses to create a separate Gig. Future postings with that
identity return all current candidates for another explicit choice.

Historical company, requisition ID, and URL values remain visible through
`gig_history` but never enter the candidate query.

## Gig-domain contract

`GigDomainService` owns candidate resolution and applying a posting. Scout does
not reproduce matching, duplicate, or posting-to-Gig mapping rules.

The read side returns an ordered candidate set and a fingerprint over the exact
posting identity plus the displayed candidate IDs, revisions, match reasons,
and current job-description versions. Ordering is exact requisition evidence
first, exact URL evidence second, exact title evidence third, then active before
closed and stable Gig ID as the final tie-breaker.

The mutation accepts the full posting and an optional reviewed resolution:

```ts
type PostingResolution =
  | {
      kind: "create_new";
      reviewedFingerprint: string;
    }
  | {
      kind: "use_existing";
      reviewedFingerprint: string;
      gigId: string;
      expectedGigRevision: number;
    };

type AcceptPostingResult =
  | { status: "created"; gig: GigRecord }
  | { status: "updated"; gig: GigRecord }
  | {
      status: "resolution_required";
      fingerprint: string;
      candidates: GigPostingCandidate[];
    }
  | {
      status: "resolution_stale";
      fingerprint: string;
      candidates: GigPostingCandidate[];
    }
  | { status: "resolution_invalid" };
```

No resolution and no candidates creates a Gig. Candidates without a resolution
return `resolution_required`. A reviewed `create_new` creates a separate Gig. A
reviewed `use_existing` applies the posting to that Gig. Before mutation, the
domain recalculates the candidate set and fingerprint and checks the selected
Gig revision. Changed evidence returns `resolution_stale`; a selected Gig that
was not reviewed returns `resolution_invalid`.

These statuses are ordinary domain outcomes, not exceptions. Only malformed
input, persistence failure, or an invariant violation throws an error.

The existing general Gig creation path shares the same underlying create and
validation implementation. Agent and CLI adapters receive their existing
structured conflict result when candidate resolution is required; adding a way
for those clients to submit a resolution is outside this issue.

## Core service module ownership

Core service ownership must be apparent from the module structure as well as
from runtime behavior. The legacy `src/core/tracker-services.ts` catch-all is
removed rather than retained as a compatibility path.

Each implementation has one explicit home:

- `src/core/gig-domain-service.ts` contains `GigDomainService` and Gig-only
  implementation helpers;
- `src/core/task-domain-service.ts` contains `TaskDomainService` and Task-only
  implementation helpers;
- `src/core/artifact-domain-service.ts` contains `ArtifactDomainService`; and
- `src/core/deep-patch.ts` contains the shared immutable object-patch helper
  used across domain services.

Domain contracts, schemas, and result types remain in their existing contract
modules such as `gigs.ts` and `tasks.ts`. Consumers import the service they use
from its owning module. `core/index.ts` may re-export those canonical modules,
but no compatibility re-export or alternate implementation path remains under
`tracker-services.ts`.

This is an organization and dependency-clarity change, not a behavior change.
`GigDomainService` still owns posting candidate resolution and Gig mutation;
`ScoutPositionService` depends only on its narrow `resolvePosting` and
`acceptPosting` capabilities and retains Scout workflow and managed-document
orchestration. Existing dependency-cruiser service-boundary rules continue to
apply to the explicitly named service modules.

## Confirmed Gig updates

When the user confirms an existing Gig, the Gig domain maps the complete
posting onto posting-owned Gig fields:

- title;
- requisition ID;
- official URL;
- location; and
- work arrangement.

The company is identity evidence and is not silently renamed by a posting.
Pipeline stage, outcome, fit, status summary, last activity, next action,
compensation, recruiter information, tags, people, tasks, interactions, and
user-authored documents remain unchanged. Posted date also remains unchanged
because the current `NormalizedPosition` contract does not carry it; adding
that source field is outside this issue.

The prior complete Gig row is retained by the normal audited Gig update. No Gig
ID or related foreign key is rewritten.

## Scout promotion flow

Pursue has two phases only when candidates exist:

1. Scout reconstructs the exact reviewed `NormalizedPosition` and asks the Gig
   domain for candidates.
2. With no candidates, Scout records the pursue decision and durable promotion
   intent, then accepts the posting immediately.
3. With candidates, Scout returns `resolution_required` without recording a
   decision or changing state.
4. The review drawer shows the position and candidate Gigs side by side. Each
   candidate includes company, title, requisition ID, official URL, location,
   stage, outcome, availability, last activity, and a link to its stored job
   description. The Scout description also opens in GigFinder's document view.
5. The user selects an existing Gig or Create separate Gig. No note is required.
6. Scout validates the exact reviewed position revision and candidate
   fingerprint, records the pursue decision and durable promotion intent, and
   asks the Gig domain to accept the complete posting.
7. `ScoutPositionService` coordinates the returned Gig with
   `ManagedDocumentService`. A missing job-description document is created;
   changed Markdown creates exactly one immutable version; unchanged Markdown
   creates no version.
8. Only after the Gig and document verify does Scout complete the promotion,
   link the position, and remove it from review.

If candidate evidence changes after confirmation, the position remains
reviewable and the refreshed comparison is returned. A successful existing-Gig
confirmation does not automatically reopen a closed Gig or change any pipeline
state.

## Persistence and migration

The Gig schema does not gain an identity or alias table. Existing `gigs` and
`gig_history` fields remain authoritative for current and historical values.

Extend `scout_position_promotions` with durable resolution inputs:

- the exact reviewed observation ID;
- resolution kind;
- requested Gig ID;
- expected Gig revision for an existing-Gig choice; and
- reviewed candidate fingerprint.

The requested Gig ID is separate from the existing completed `gig_id` foreign
key because a confirmed new Gig does not exist when intent is recorded. New
promotion rows must have a coherent resolution shape. Historical completed rows
remain readable. Existing pending or failed promotions retain their decisions
and descriptions but return to resolution instead of replaying the former
company/title duplicate failure.

The promotion saga retains deterministic Gig and document change IDs. A retry
reuses an already-created or already-updated Gig, verifies the selected posting
and document result, and completes Scout linkage once. It cannot create a
second Gig or duplicate document version.

## HTTP and UI behavior

The existing position-decision endpoint returns the discriminated promotion
outcome rather than converting resolution states into errors. A follow-up
resolution request supplies only the reviewed fingerprint, resolution kind,
selected Gig ID, and expected revision; it cannot supply a Gig patch.

The review drawer remains open when resolution is required. It replaces the
normal action area with the comparison and explicit choices. Stale results
refresh in place. Validation and infrastructure failures remain actionable and
do not remove the row, note, or current filters. Successful creation or linking
removes only that position and preserves list scroll position.

## Verification

All committed fixtures are synthetic. Coverage includes:

- same company/title with different requisition IDs, followed by confirmed
  separate creation;
- exact company/requisition candidate followed by confirmed existing-Gig
  update;
- no candidates followed by immediate creation from Pursue;
- missing requisition ID with exact-title and exact-URL advisory candidates;
- multiple exact and advisory candidates without silent selection;
- case and whitespace normalization while preserving display values;
- active and closed candidates;
- deliberately reused requisition IDs;
- stale candidate fingerprints and Gig revisions;
- invalid candidate selection;
- unchanged and changed managed job descriptions;
- creation/update success followed by document failure and idempotent retry;
- preservation of Gig IDs, history, documents, tasks, people, interactions,
  and historical or pending Scout promotions during migration; and
- browser comparison, document links, create-separate, use-existing, stale
  refresh, row removal, and stable scroll position.

The synthetic Visa-equivalent regression uses one company, two same-title
postings, and distinct requisition IDs. No production record mutation or
private-site verification is part of the release.

## Documentation impact

- Update FRR-001 to define current Gig posting identity and confirmed
  resolution.
- Update FRR-006 to define Pursue comparison and resolution behavior.
- Add a short ADR recording one current posting identity per Gig,
  history-reference-only prior values, and Gig-domain-owned resolution.
- Add only the ADR link to the architecture overview; no structural diagram
  change is required.

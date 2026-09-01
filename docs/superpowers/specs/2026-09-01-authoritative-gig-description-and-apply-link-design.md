# Authoritative Gig Description and Apply Link

**Issue:** [#149 — Fix promoted Gig description display and Apply destination](https://github.com/paulmccallick/gig-finder/issues/149)

## Problem

The Gig drawer still uses two legacy projections instead of the authoritative
Gig state:

- job-description availability and content come from a filesystem flag and
  artifact reader even when the Gig has a current linked managed document; and
- Apply uses the Gig URL, but historical Scout promotions could populate that
  field from description-acquisition provenance instead of the posting's
  canonical official URL.

This creates two user-visible failures. A Gig can report that no description is
available while its managed job description exists, and Apply can open a
search or acquisition endpoint that is not the official posting.

Production inspection also established that the legacy job-description flag
provides no unique coverage: no non-deleted Gig relies on a filesystem-only job
description. Interview-preparation artifacts remain a separate, valid
filesystem feature.

## Goals

This change will:

- make a linked managed `job_description` the only authoritative Gig job
  description;
- remove the obsolete Gig job-description filesystem flag and read path;
- retain the existing filesystem-backed interview-preparation behavior;
- render the current managed Markdown in the Gig drawer and provide the normal
  Open document action;
- make Apply open the Gig's current official posting URL;
- repair confirmed bad official URLs through `GigDomainService`;
- create missing managed job descriptions when authoritative Scout Markdown is
  already available;
- limit repair to non-deleted Gigs whose stage is not `closed`;
- preserve immutable managed-document versions and audited Gig history; and
- keep all cross-domain mutation behind the owning domain service.

## Non-goals

- Closed or deleted Gigs will not be repaired.
- The repair will not search the web, rerun Scout, or acquire a missing
  description.
- A Gig without authoritative Scout Markdown will remain without a job
  description.
- User-authored managed documents will not be overwritten or renamed.
- Interview-preparation artifacts will not be migrated or redesigned.
- Legacy job-description files will not be deleted from disk by the schema
  migration or deployment.
- No new ADR is required. The change completes the already accepted ownership
  rules in ADRs 0006, 0016, and 0017.

## Authoritative read model

`GigDomainService` already returns document summaries linked to a Gig. Those
links, together with `ManagedDocumentService`, are the only source of
job-description availability and content.

For each Gig, the UI selects the current linked document whose type is
`job_description`. If more than one exists because of historical data, it uses
the same ID ordering already applied by the Gig domain's posting-candidate read
model. The drawer then loads that document's current immutable version through
the managed-document API. It does not read content from the Gig list payload or
from a filesystem path.

The drawer renders the Markdown inline using GigFinder's existing managed
document presentation. The user can expand or collapse the inline content and
can choose Open document to navigate to the normal exact-version document
view. That view retains its existing Back behavior.

When no linked managed `job_description` exists, the drawer explicitly says
that no captured job description is available. It never consults a legacy
flag as a fallback.

## Apply behavior

Apply uses only the current `sourceUrl` on the Gig returned by the Gig domain.
It opens that URL in a new browser context. The action is unavailable when the
Gig has no official URL.

Apply must never target:

- a managed-document or GigFinder document-view URL;
- a filesystem artifact path;
- a Scout search or listing API endpoint; or
- a description-acquisition URL.

The UI does not infer or reconstruct an official URL from document provenance.
The Gig domain remains authoritative for the Gig's current posting identity.

## Removing the legacy job-description projection

The `has_job_description` column is removed from both `gigs` and
`gig_history`. The corresponding field is removed from Gig domain records,
input schemas, repository mappings, CLI projections, and synthetic fixtures.
The migration rebuilds both tables while preserving every remaining column,
row, revision, history record, constraint, index, and foreign-key relationship.

The artifact port and local artifact store stop exposing job-description reads,
existence checks, and verification expectations. Artifact verification
continues to cover interview-preparation files through
`has_interview_prep`. Existing job-description files are left untouched on disk
but are no longer discovered, verified, served, or treated as application
state.

The Gig domain removes its legacy description method. The document reader no
longer merges a filesystem description into managed-document results. The
Gig-artifacts HTTP route is removed. Interview-preparation remains available
through the existing domain and document-reader paths; it does not require
that drawer-only route.

## Bounded repair workflow

Repair is an explicit post-deployment CLI operator command with separate
preview and apply phases and structured JSON results. Preview is read-only.
Apply accepts an explicit allowlist of at most 1,000 Gig IDs plus the reviewed
preview fingerprint and is idempotent. It never implicitly applies every
eligible row.

Both phases are restricted to Gigs that are:

- not deleted;
- not in stage `closed`; and
- linked to an exact current Scout position when Scout evidence is required.

The preview returns bounded metadata only: Gig ID, company, title, linked
position ID, current official URL, candidate canonical URL, description
availability, proposed action, and reason. It never emits job-description
content, artifacts, configuration payloads, or private source responses.

### Official-URL repair

A URL is eligible only when the exact linked Scout position has an immutable
canonical observation URL and the current Gig URL can be attributed to the
older promotion path that copied description-acquisition provenance. The
attribution requires the current Gig URL to equal the exact acquisition URL
stored for the position's currently projected description while differing
from the immutable observation's canonical URL. A mere URL difference is
insufficient.

The preview identifies the current and proposed URLs and the attribution
reason. Apply revalidates the Gig revision, its non-closed state, the exact
position link, and the same immutable observation before mutation. It invokes
a narrow `GigDomainService` capability that updates the official posting URL
through the normal audited Gig change transaction. It preserves the Gig ID,
company, title, requisition ID, pipeline state, relationships, documents,
tasks, people, interactions, and all other fields.

An already-correct URL is `unchanged`. Stale evidence, an unprovable mismatch,
or a closed/deleted Gig is rejected without mutation.

### Missing managed-description repair

A description is eligible only when the Gig has no linked managed
`job_description` and its exact linked Scout position's current projection
references authoritative normalized Markdown with acquisition provenance. The
repair does not choose an arbitrary prior description or infer recency from
timestamps. Apply revalidates the Gig, position, projected description
identity, and absence of a managed job description.

The repair creates the document through `ManagedDocumentService`, links it to
the Gig, and carries the exact stored Scout provenance into immutable version
1. It uses a deterministic repair change identity so a retry returns the same
document instead of creating a duplicate. It does not write managed-document
tables directly.

If a document appears after preview, the operation reconciles it and reports
`unchanged` only when its exact ownership, type, content, and provenance match.
A mismatch is a conflict and is not overwritten. A position with no stored
Scout Markdown is reported as unavailable and is not mutated.

URL correction and document creation are independent proposed actions. A Gig
may require either or both. Each owning service records its own audited change;
the operator result reports the exact outcome of each action. A failure in one
does not fabricate completion of the other, and a rerun safely reconciles any
successful prior action.

## Ownership and service boundaries

The operator adapter coordinates only the bounded preview and execution. It
does not own Gig or document mutation rules.

- `GigDomainService` owns official-URL validation, revision checking, history,
  and mutation of `gigs` and `gig_history`.
- `ManagedDocumentService` owns document creation, linkage, immutable versions,
  provenance, and idempotent replay.
- Scout persistence provides read-only access to the exact linked position,
  observation, and stored description evidence needed by the repair.
- Data adapters do not invoke another domain service or reproduce another
  domain's mutation SQL.
- The composition root wires the repair coordinator to the two domain
  capabilities and the read-only Scout evidence port.

This follows ADR 0016. No direct repair SQL against Gig or managed-document
tables is permitted.

## Failure and recovery behavior

Preview reports per-Gig eligibility and a stable reason instead of failing the
entire scan for an ineligible row. Infrastructure or database failures remain
explicit and stop the operation from claiming a complete preview.

Apply returns a bounded per-Gig result with the URL and document outcomes:
`updated`, `created`, `unchanged`, `unavailable`, `stale`, `conflict`, or
`failed`. The result contains identifiers and failure codes, not document
content.

Every mutation is revision-checked, audited, and idempotent. The repair can be
restarted after interruption. It never rolls back a committed domain mutation
by editing storage directly. A subsequent preview reflects the committed
state and proposes only remaining work.

## Security and privacy

- Tests and tracked examples use synthetic records only.
- Preview and status output contain bounded metadata and no description body.
- The repair reads only registered Scout and managed-document state; it cannot
  read arbitrary filesystem paths.
- Browser links use the current managed-document route or the stored official
  HTTPS posting URL. Rendering Markdown does not enable raw HTML execution.
- Existing URL validation and external-link protections remain in force.

## Verification

The implementation uses the test pyramid:

1. Domain tests prove the Gig URL repair preserves every unrelated field,
   writes audited history, rejects stale/closed/unattributed updates, and is
   idempotent.
2. Managed-document service tests prove deterministic creation, exact
   provenance, immutable version history, conflict handling, and no overwrite
   of user-authored documents.
3. Data and migration tests prove `has_job_description` is removed without
   losing Gig/history data, constraints, indexes, foreign keys, or
   `has_interview_prep`; artifact verification remains correct for interview
   preparation.
4. HTTP and component tests prove the drawer loads the current managed version,
   renders Markdown, exposes Open document, shows the unavailable state, and
   makes Apply use only `Gig.sourceUrl`.
5. Synthetic end-to-end tests cover a managed-description Gig whose former
   legacy flag would have been false, a bad acquisition URL corrected to an
   immutable canonical observation URL, a missing managed description created
   from stored Scout Markdown, and an ineligible missing-description Gig.

The required application gates are `bun run db:check`, `bun run check`,
`bun run build`, and `bun run test:e2e`. No live-site test or production-record
fixture is required.

## Rollout

1. Deploy the schema, domain, API, and UI changes through the normal immutable
   release workflow.
2. Verify production health, database integrity, foreign keys, and that the
   Gig drawer reads managed documents.
3. Run the bounded repair preview for non-closed Gigs and retain its
   metadata-only report outside source control.
4. Review the exact proposed URL and document actions.
5. Run apply for the reviewed set.
6. Rerun preview and verify that repaired rows are unchanged and ineligible
   rows remain explicitly unavailable.

The release does not delete legacy files. Any later filesystem cleanup is a
separate operational decision.

## Documentation impact

- Update FRR-001 to state that Apply uses the Gig's current official posting
  URL and Gig details obtain job descriptions from linked managed documents.
- Update FRR-005 to state that linked managed documents are the sole
  authoritative Gig job-description source.
- Update the product overview to remove any implication that registered Gig
  job descriptions can come from a legacy artifact projection.
- Update infrastructure documentation only where it describes Gig
  job-description artifacts; retain the general runtime artifact mount and
  interview-preparation ownership.
- Do not add or amend an ADR: this change implements the accepted decisions in
  ADRs 0006, 0016, and 0017 without changing their architecture.

## Acceptance criteria

- A non-closed Gig with a linked managed job description displays its current
  Markdown in the drawer even when no legacy artifact exists.
- Open document opens the same exact managed version in GigFinder's document
  view.
- Apply opens the Gig's current canonical official posting URL and never a
  document, artifact, search, or acquisition URL.
- A non-closed Gig without a managed job description has an explicit
  unavailable state.
- The legacy Gig job-description flag and read path are absent while
  interview-preparation artifacts continue to work.
- Preview identifies only provably affected, non-closed Gigs and emits no
  description content.
- URL repairs use `GigDomainService` and create audited Gig history.
- Missing descriptions with stored authoritative Scout Markdown are created
  through `ManagedDocumentService` with exact provenance and immutable
  history.
- Missing descriptions without stored Scout Markdown remain unavailable.
- Repeating apply creates no duplicate Gig revision, managed document, link,
  or document version.

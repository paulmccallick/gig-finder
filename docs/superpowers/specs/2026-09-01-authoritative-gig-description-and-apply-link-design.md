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

Production inspection also established that the legacy artifact flags provide
no unique coverage: no non-deleted Gig relies on a filesystem-only job
description, and supported interview preparation is already represented by
managed `interview_prep` documents linked to a Gig or Candidate Profile.

## Goals

This change will:

- make a linked managed `job_description` the only authoritative Gig job
  description;
- remove the obsolete Gig filesystem artifact flags, readers, synchronization,
  and verification paths;
- render the current managed Markdown in the Gig drawer and provide the normal
  Open document action;
- make Apply open the Gig's current official posting URL;
- repair confirmed bad official URLs and missing descriptions by reprocessing
  and re-promoting the exact linked Scout positions;
- limit repair to non-deleted Gigs whose stage is not `closed`;
- preserve immutable managed-document versions and audited Gig history; and
- keep all cross-domain mutation behind the owning domain service.

## Non-goals

- Closed or deleted Gigs will not be repaired.
- A Gig without an exact linked Scout position cannot be repaired by this
  workflow.
- A linked position whose current official description cannot be acquired will
  remain without a new managed description and will report the acquisition
  failure.
- User-authored managed documents will not be overwritten or renamed.
- Legacy Gig artifact files will not be deleted from disk by the schema
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

## Removing the legacy Gig artifact projection

The `has_job_description` and `has_interview_prep` columns are removed from both
`gigs` and `gig_history`. The corresponding fields are removed from Gig domain
records, input schemas, repository mappings, CLI projections, and synthetic
fixtures. The migration rebuilds both tables while preserving every remaining
column, row, revision, history record, constraint, index, and foreign-key
relationship.

The Gig filesystem artifact port, local store, artifact domain service, and
artifact sync/verify commands are removed rather than retained as unsupported
compatibility paths. Existing files are left untouched on disk but are no
longer discovered, verified, served, synchronized, or treated as application
state.

The Gig domain removes its legacy description and preparation methods. The
document reader no longer merges filesystem content into managed-document
results. The Gig-artifacts HTTP route is removed. Supported job descriptions
and interview preparation remain ordinary managed documents with immutable
versions and Gig or Profile links.

## Re-promotion through exact-ID backfill

Repair reuses the existing exact-ID position-backfill preview, start, and status
API. It does not add a repair CLI, repair table, direct mutation operation, or
second promotion implementation. Preview remains read-only; start requires an
explicit allowlist of at most 1,000 position IDs and an operator reason. It
never implicitly processes every eligible row.

For a position already linked to a Gig, the backfill reruns the complete current
position pipeline: authoritative posting reconstruction, description
acquisition and normalization, relevance evaluation, and candidate scoring.
After successful processing, `ScoutPositionService` reuses its normal promotion
coordinator with a fresh `use_existing` resolution for the same linked Gig.
That coordinator calls `GigDomainService.acceptPosting()` and then coordinates
the managed job description through `ManagedDocumentService`.

The current backfill-only managed-document projection path is removed. Initial
promotion and re-promotion share one implementation for applying the posting,
creating or updating the managed document, verifying replay, and reporting
completion.

The shared implementation is a core promotion step, not a second public
workflow. Initial Pursue wraps it with the existing durable user decision and
promotion attempt. Re-promotion wraps it with the existing durable backfill
item and processing records; it does not create another user decision or reuse
and rewrite the completed promotion row. The backfill run ID and position ID
derive deterministic Gig and document change IDs, so queue recovery re-enters
the same domain changes. The backfill item records the re-promotion outcome
only after both the Gig and managed-document results verify.

Re-promotion is restricted to positions whose linked Gigs are:

- not deleted;
- not in stage `closed`; and
- still the exact Gig recorded on the promoted Scout position.

The existing backfill preview is extended to report bounded re-promotion
metadata: position ID, Gig ID, company, title, current official URL, observed
canonical URL, current managed-description ID or unavailable state, and an
eligibility or rejection reason. It never emits job-description content,
artifacts, configuration payloads, or private source responses.

### Updating the linked Gig

The original Pursue decision established that the position belongs to the
linked Gig. Re-promotion does not ask the user to resolve that same relationship
again and cannot select or create a different Gig. It resolves current
candidate evidence through `GigDomainService`, supplies a fresh reviewed
fingerprint and expected Gig revision for that exact Gig, and stops with a
stable conflict if the linked Gig is no longer a valid candidate.

`GigDomainService.acceptPosting()` applies the current complete
`NormalizedPosition` to the existing Gig. It updates posting-owned title,
requisition ID, canonical official URL, location, and work arrangement when
the new posting supplies them. It preserves the Gig ID, company, pipeline
state, relationships, documents, tasks, people, interactions, and all other
pipeline-owned fields. The normal Gig transaction records immutable history.

This naturally repairs historical Gigs whose Apply URL came from acquisition
provenance: the current posting's immutable canonical URL replaces it during
the normal Gig-domain update. No URL-specific repair rule or mutation method is
needed.

### Updating the managed job description

After the backfill acquires and normalizes the current official description,
the shared promotion coordinator uses that exact Markdown and provenance. If
the Gig has no managed `job_description`, it creates and links one through
`ManagedDocumentService`. If the Markdown changed, it creates one immutable
version. If the Markdown is unchanged, it creates no version and does not
require historical provenance to match the new acquisition.

Re-promotion uses deterministic per-backfill change identities. A retry
reconciles a previously committed Gig update, document creation, or document
version instead of duplicating it. It verifies exact document ownership, type,
media type, content, and the provenance attached to any version created by that
attempt.

If authoritative description acquisition fails, the position backfill reports
the failure and does not pretend that re-promotion completed. A position with
no linked Gig follows the existing backfill behavior and is not a repair
candidate for this issue.

## Ownership and service boundaries

`ScoutPositionService` coordinates initial promotion and re-promotion. It does
not own Gig or document mutation rules.

- `GigDomainService` owns official-URL validation, revision checking, history,
  and mutation of `gigs` and `gig_history`.
- `ManagedDocumentService` owns document creation, linkage, immutable versions,
  provenance, and idempotent replay.
- Scout persistence records durable backfill and promotion attempts and
  reconstructs the exact current posting and description evidence.
- Data adapters do not invoke another domain service or reproduce another
  domain's mutation SQL.
- The composition root continues to wire the one Scout promotion coordinator
  to the Gig and managed-document capabilities.

This follows ADR 0016. No direct repair SQL against Gig or managed-document
tables is permitted.

## Failure and recovery behavior

Preview reports per-position eligibility and a stable reason instead of
failing the entire request for an ineligible row. Infrastructure or database
failures remain explicit and stop the operation from claiming a complete
preview.

Backfill status retains its durable per-position results and adds the
re-promotion outcome: `updated`, `unchanged`, `unavailable`, `stale`,
`conflict`, or `failed`. The result contains identifiers and failure codes, not
document content.

Every mutation is revision-checked, audited, and idempotent. Queue recovery can
resume the backfill after interruption. It never rolls back a committed domain
mutation by editing storage directly. Repeating the exact request safely
reconciles prior work.

## Security and privacy

- Tests and tracked examples use synthetic records only.
- Preview and status output contain bounded metadata and no description body.
- Re-promotion reads only registered Scout and managed-document state; it cannot
  read arbitrary filesystem paths.
- Browser links use the current managed-document route or the stored official
  HTTPS posting URL. Rendering Markdown does not enable raw HTML execution.
- Existing URL validation and external-link protections remain in force.

## Verification

The implementation uses the test pyramid:

1. Domain tests prove reapplying a complete posting to an existing Gig updates
   only posting-owned fields, writes audited history, rejects stale or invalid
   resolution, and is idempotent.
2. Managed-document service tests prove deterministic creation, exact
   provenance, immutable version history, conflict handling, and no overwrite
   of user-authored documents.
3. Data and migration tests prove both legacy artifact flags and their service,
   port, synchronization, and verification paths are removed without losing
   Gig/history data, constraints, indexes, foreign keys, or managed documents.
4. HTTP and component tests prove the drawer loads the current managed version,
   renders Markdown, exposes Open document, shows the unavailable state, and
   makes Apply use only `Gig.sourceUrl`.
5. Synthetic end-to-end tests cover a managed-description Gig whose former
   legacy flag would have been false, a full exact-ID backfill that re-promotes
   an existing Gig and replaces a bad acquisition URL with the canonical
   posting URL, missing managed-document creation, changed and unchanged
   document content, and an ineligible description acquisition.

The required application gates are `bun run db:check`, `bun run check`,
`bun run build`, and `bun run test:e2e`. No live-site test or production-record
fixture is required.

## Rollout

1. Deploy the schema, domain, API, and UI changes through the normal immutable
   release workflow.
2. Verify production health, database integrity, foreign keys, and that the
   Gig drawer reads managed documents.
3. Run the existing exact-ID position-backfill preview for the affected
   promoted positions and retain its metadata-only report outside source
   control.
4. Review the exact accepted and rejected position IDs.
5. Start the backfill for the reviewed accepted IDs and monitor its durable
   status to a terminal outcome.
6. Verify each successful position retained the same linked Gig, its posting
   fields reflect the current official posting, and its managed description is
   present and current. Rejected or failed positions remain explicit.

The release does not delete legacy files. Any later filesystem cleanup is a
separate operational decision.

## Documentation impact

- Update FRR-001 to state that Apply uses the Gig's current official posting
  URL and Gig details obtain job descriptions from linked managed documents.
- Update FRR-005 to state that linked managed documents are the sole
  authoritative Gig job-description source.
- Update FRR-006 so a promoted-position rerun reuses normal promotion to update
  both posting-owned Gig fields and its managed job description.
- Update the product overview to remove any implication that registered Gig
  job descriptions can come from a legacy artifact projection.
- Update infrastructure documentation only if it names the removed legacy Gig
  artifact subsystem; the general runtime artifact mount remains because Scout
  and managed-document projections still use it.
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
- Both legacy Gig artifact flags and every filesystem read, synchronization,
  verification, domain, CLI, and HTTP path built on them are absent. Managed
  `job_description` and `interview_prep` documents remain supported.
- Exact-ID backfill preview identifies eligible promoted positions without
  emitting description content.
- Reprocessing a promoted position reruns the complete current pipeline and
  reuses the normal Scout promotion coordinator for the same linked Gig.
- Re-promotion calls `GigDomainService.acceptPosting()` and creates audited Gig
  history when current posting-owned fields changed.
- Missing or changed descriptions are handled through the same
  `ManagedDocumentService` flow as initial promotion, with exact provenance and
  immutable history; unchanged Markdown creates no version.
- A description acquisition failure remains explicit and does not report a
  successful re-promotion.
- Repeating or recovering the backfill creates no duplicate Gig revision,
  managed document, link, document version, decision, or promotion outcome.

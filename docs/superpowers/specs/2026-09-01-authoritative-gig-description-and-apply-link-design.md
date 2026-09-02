# Authoritative Gig Description and Apply Link

**Issue:** [#149 — Fix promoted Gig description display and Apply destination](https://github.com/paulmccallick/gig-finder/issues/149)

## Purpose

Gig details must present the job description and official posting associated
with the Gig. Scout promotion must be able to reapply its current authoritative
posting to an existing Gig when that Gig was created from incomplete or
incorrect historical Scout data.

The production defects motivating this work are:

- the BECU Gig has a linked managed job description, but the drawer reports no
  description because it reads a legacy filesystem projection; and
- the Providence Gig's Apply action opens a description-acquisition search URL
  even though its Scout observation contains the canonical official posting
  URL.

## Outcomes

- A linked managed `job_description` is the authoritative Gig job description.
- The Gig drawer renders that document's current Markdown and links to its
  normal GigFinder document view.
- Apply opens the Gig's current canonical official posting URL.
- The existing promotion retry operation can reapply a completed promoted
  position to its existing Gig.
- Gig and managed-document changes use their existing domain services and
  preserve immutable history.
- The obsolete Gig filesystem artifact projection is removed from the
  application while existing files remain untouched on disk.

## Gig description read model

`GigDomainService` returns the managed-document summaries linked to each Gig.
The Gig drawer selects the current linked document whose type is
`job_description`. If historical data contains more than one, it uses the same
stable document-ID ordering as the Gig domain's posting-candidate read model.

The drawer retrieves the document's current immutable version through the
managed-document API and renders its Markdown inline with GigFinder's existing
document presentation. The description can be expanded or collapsed. Open
document navigates to the normal exact-version document view, whose existing
Back action returns to the prior screen.

When the Gig has no linked managed `job_description`, the drawer displays an
explicit unavailable state.

## Apply behavior

Apply uses `Gig.sourceUrl`, which is the Gig domain's current canonical official
posting URL. It opens the URL in a new browser context. The action is
unavailable when `sourceUrl` is absent.

The UI does not derive an Apply destination from a managed document, document
provenance, Scout acquisition URL, or filesystem path. The Gig domain owns the
posting identity presented by the Gig.

## Managed documents replace the Gig artifact projection

The `has_job_description` and `has_interview_prep` columns are removed from
`gigs` and `gig_history`. Their domain fields, repository mappings, HTTP
projection, and synthetic fixtures are removed with them. The migration
preserves every other row, revision, history value, constraint, index, and
foreign-key relationship.

The Gig filesystem artifact port, local store, domain service, HTTP route, and
sync/verification commands are removed. The document reader works exclusively
with managed documents. Existing filesystem contents are not deleted during
migration or deployment.

Job descriptions remain managed `job_description` documents linked to a Gig.
Interview preparation remains a managed `interview_prep` document linked to a
Gig or Candidate Profile. Both retain normal immutable version history.

## Promotion retry

The established recovery operation is:

`POST /api/gig-scout/positions/:positionId/promotion/retry`

For pending or failed work, it continues the existing promotion attempt. For a
completed promoted position, it reconstructs the current promotion input and
reapplies it to the position's existing linked Gig.

A completed position is eligible when:

- it remains in the promoted state and links to exactly one Gig;
- its current Scout projection has a complete successful normalized posting
  and Markdown description;
- the linked Gig exists, is not deleted, and is not closed; and
- `GigDomainService.resolvePosting()` still identifies that exact Gig as a
  candidate for the current posting.

The original Pursue decision established the relationship between the position
and the Gig. Retry therefore targets that same Gig without another resolution
choice and cannot create or select a different Gig.

`ScoutPositionService` reconstructs the current `NormalizedPosition`, current
description Markdown, and description provenance. It supplies a current
`use_existing` resolution for the linked Gig to the same internal promotion
operation used by initial Pursue.

That shared operation performs two domain-owned steps:

1. `GigDomainService.acceptPosting()` applies the current posting to the linked
   Gig.
2. `ManagedDocumentService` creates the missing managed job description,
   creates a new immutable version when Markdown changed, or retains the
   current version when Markdown is unchanged.

The endpoint keeps the existing `ScoutPursueResult` contract. A successful
completed-position retry returns `updated`. Current resolution-stale and
resolution-invalid outcomes retain their existing meanings. Invalid or
incomplete current Scout state uses the existing validation-error response.

## Gig update semantics

`GigDomainService.acceptPosting()` owns the Gig mutation. It applies these
posting-owned values from the current `NormalizedPosition`:

- title;
- requisition ID;
- canonical official URL;
- location; and
- work arrangement.

The update preserves the Gig ID, company, pipeline stage and outcome,
availability, relationships, documents, tasks, people, interactions, and every
other pipeline-owned field. A changed Gig is recorded through the normal
audited Gig transaction and immutable `gig_history`.

This is how a historical acquisition URL is corrected: the current posting's
canonical URL is reapplied through the normal Gig domain operation.

## Managed job-description semantics

The promotion operation supplies the current Scout Markdown and exact
acquisition provenance to `ManagedDocumentService`.

- If the linked Gig has no managed `job_description`, the service creates and
  links one.
- If the current document has different Markdown, the service creates one new
  immutable version.
- If the Markdown is unchanged, the service creates no version and preserves
  the existing document metadata and provenance.
- User-authored document titles and metadata are preserved.

The operation verifies document ownership, type, media type, content, linkage,
and the provenance of any version created by that attempt.

## Idempotency and recovery

Completed-position retry derives deterministic internal change identities from
the position ID, linked Gig ID, current observation, and current description.
Repeating the same retry reconciles any already-committed Gig or document
change and then completes the remaining work. It does not create duplicate Gig
revisions, documents, links, or document versions.

A later successful Scout observation or description changes the deterministic
retry identity, so a subsequent promotion retry represents a new authoritative
posting revision.

Completed-position retry does not create a new user decision, change the Scout
position state, or rewrite its completed promotion record. Scout persistence
only reconstructs the current promotion input. Gig and document persistence is
performed by the owning domain services.

When a position lacks a complete current projection, the operator first uses
the existing Scout recovery workflow and then invokes promotion retry. This
change does not alter backfill behavior or its managed-document projection.

## Service boundaries

- `ScoutPositionService` coordinates the promotion workflow.
- `GigDomainService` owns posting matching, validation, revision checks, Gig
  mutation, audit, and history.
- `ManagedDocumentService` owns document creation, linkage, immutable versions,
  provenance, and replay.
- Scout persistence reconstructs current observations, descriptions, and
  promotion bindings.
- Data adapters depend on domain contracts and do not invoke domain services or
  reproduce another domain's mutation SQL.
- The composition root wires the coordinator to the Gig and managed-document
  services.

These boundaries implement ADRs 0016 and 0017.

## Security and privacy

- Tracked tests and examples contain synthetic data only.
- Retry responses contain bounded identifiers and failure details, never
  description bodies or source payloads.
- Description rendering does not enable raw HTML execution.
- External links retain GigFinder's existing HTTPS validation and browser
  protections.
- Promotion reconstruction reads registered application state and cannot read
  arbitrary filesystem paths.

## Verification

The implementation follows the test pyramid:

1. Gig domain tests prove that accepting a posting updates only posting-owned
   fields, preserves pipeline-owned fields, records changed history, rejects
   stale evidence, and replays idempotently.
2. Managed-document tests prove creation, changed-content versioning,
   unchanged-content reuse, provenance, ownership, and deterministic replay.
3. Scout service and store tests prove completed-position reconstruction,
   same-Gig enforcement, current-evidence validation, and unchanged Scout
   decision/state/history.
4. Migration tests prove removal of both legacy flags while preserving Gig and
   history data, constraints, indexes, and foreign keys.
5. HTTP and component tests prove managed-description rendering, Open document,
   unavailable state, and Apply behavior.
6. Synthetic end-to-end tests cover BECU-equivalent description display,
   Providence-equivalent URL correction, creation of a missing managed
   description, changed and unchanged Markdown, exact retry, stale evidence,
   and incomplete current Scout state.

The application gates are `bun run db:check`, `bun run check`,
`bun run build`, and `bun run test:e2e`. Synthetic coverage is sufficient for
this change.

## Rollout and production repair

1. Deploy the schema, domain, service, API, and UI changes through the normal
   immutable release workflow.
2. Verify production health, database integrity, foreign keys, managed
   description rendering, and Apply behavior.
3. Use the existing read APIs to identify the exact affected non-closed Gigs
   and their linked promoted positions.
4. Invoke the existing promotion retry endpoint once for each exact affected
   position.
5. Verify that each position remains linked to the same Gig, posting-owned Gig
   fields match the current Scout posting, and the managed job description is
   present and current.

The release leaves existing legacy files on disk. Closed Gigs, deleted Gigs,
and Gigs without an exact linked Scout position are outside the repair set.

## Documentation impact

- FRR-001 states that Apply uses the Gig's current official posting URL and Gig
  details read job descriptions from linked managed documents.
- FRR-005 states that linked managed documents are the authoritative Gig
  job-description source.
- FRR-006 describes completed promotion retry as reapplying the current posting
  to its linked Gig through the existing recovery endpoint.
- The product overview describes registered Gig descriptions as managed
  documents.
- Infrastructure documentation removes only references to the Gig filesystem
  artifact subsystem. The general runtime artifact mount remains for other
  supported runtime artifacts.

This design implements accepted ADRs 0006, 0016, and 0017.

## Acceptance criteria

- A non-closed Gig with a linked managed job description renders its current
  Markdown in the drawer and opens the same exact version in the document view.
- Apply opens the Gig's canonical official posting URL in a new browser context.
- A Gig without a linked managed job description displays the unavailable
  state.
- Managed `job_description` and `interview_prep` documents retain their normal
  links and immutable histories after removal of the Gig filesystem artifact
  projection.
- The existing promotion retry endpoint accepts a completed promoted position
  and applies its current posting to the same linked Gig.
- `GigDomainService.acceptPosting()` owns all Gig changes and records history
  when posting-owned fields change.
- `ManagedDocumentService` creates a missing description, versions changed
  Markdown once, and reuses unchanged Markdown.
- Completed-position retry preserves Scout state and the original user decision
  and promotion record.
- Incomplete or stale current evidence produces the existing error or
  resolution outcome without mutation.
- Repeating the same retry is idempotent.
- The production repair updates only reviewed, exact, non-closed linked Gigs.

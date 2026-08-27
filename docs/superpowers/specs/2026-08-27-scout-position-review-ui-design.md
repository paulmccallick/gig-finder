# Scout Position Review UI Design

**Issue:** #142  
**Date:** 2026-08-27  
**Status:** Approved design

## Purpose

Make the Gig Scout Positions page a fast position-review workspace instead of
an operations monitor. A user should be able to scan candidate-match results,
open one position in the same side-drawer pattern used by Tasks, optionally
record a note, and choose Pursue, Mark irrelevant, or Defer without losing
their place in the list.

The change is limited to web presentation and interaction. Existing Scout
state, decision commands, APIs, persistence, domain services, and processing
boundaries remain unchanged.

## Review ledger

Replace the current operations-oriented table with a ledger that follows the
Tasks page design language and interaction model. Each position is one
full-width clickable row with the same typography, spacing, hover treatment,
and right-edge disclosure behavior as a task row.

The ledger shows only review-oriented information:

- candidate-match score;
- position title and a single-line, ellipsized candidate-match explanation;
- company with location as supporting text; and
- first-seen date.

The ledger does not show relevance confidence or relevance reason. Observation
count, description availability, last-seen date, processing stage, processing
status, and failures are supporting diagnostics and do not appear as primary
columns.

The whole row opens the review drawer. There is no separate Review column and
there are no decision buttons in the ledger.

Existing state, company, text, and sort controls remain available. Their visual
treatment should use the established dashboard controls rather than the
current standalone Scout styling.

## Review drawer

Opening a position uses the established `record-drawer` interaction shared by
Tasks, Networking, and Gigs. Only one right-side workspace may be active:
opening a position first closes the Agent panel, then opens the review drawer.
The Agent panel must not cover or compete with the drawer.

The drawer contains, in order:

1. title, company, and location;
2. candidate-match score and full score explanation;
3. an optional note textarea;
4. Pursue and Mark irrelevant as primary decisions, with Defer visually
   secondary;
5. the stored normalized job description and its source metadata; and
6. collapsed Scout-run, observation, processing, and failure diagnostics.

The note prompt is always present before any decision and may be submitted
blank. It uses the existing decision note field; no separate note or mutation
path is introduced.

Pursue, Mark irrelevant, and Defer use the existing revision- and
evaluation-bound decision endpoint. All decision controls are disabled while a
request is in flight so repeated clicks cannot create competing submissions.
Promotion failures continue to expose the existing retry behavior in the
drawer.

## Decision feedback and list continuity

After a successful decision, close the drawer and remove only the decided row
from the current ledger. Preserve the browser scroll position; do not jump to
the top, automatically select another position, or open another note prompt.
Rows below the removed item naturally close the gap.

Immediately after the responsive local removal, refetch the current list and
counts from the existing list endpoint. The server response is authoritative.
Preserve active filters and sorting. If removing the last item makes the
current page offset invalid, move to the nearest valid page; otherwise retain
the current pagination state.

If a decision fails, leave the drawer open, retain the typed note, re-enable
the controls, and show the server error within the drawer. The row remains in
the ledger.

Closing the drawer without deciding returns to the unchanged ledger and scroll
position.

## Job description views

The description section uses the stored Scout Markdown from the existing
position-detail response. It supports two reading modes:

- **Expand in drawer:** remove the description area's internal height limit so
  the full Markdown is readable within the drawer's normal scrolling surface.
- **Open in document view:** open a Scout-description web route that reuses
  GigFinder's existing document-view shell, `MarkdownRenderer`, loading/error
  states, and document typography.

An unpromoted Scout description is not a managed document. The viewer route
therefore reads the existing position-detail endpoint and adapts that response
to the reusable document-view presentation. It does not create a managed
document, add a persistence record, or add an API endpoint.

Add a Back control to the document-view shell. When the viewer was opened from
the Positions page in a separate browser context, Back closes that context and
reveals the still-intact Positions workspace. Otherwise it uses browser history
when available and falls back to the Positions page. Existing managed-document
viewer links receive the same escape from the current dead-end view.

A missing, revised, or unavailable Scout description displays the existing
bounded document-unavailable treatment and does not fall back to stale content.

## Content containment and responsive behavior

Reuse existing dashboard tokens, typefaces, controls, drawer structure, and
responsive breakpoints. Do not introduce a separate Scout visual language.

Candidate-match explanations wrap in the drawer and truncate to one line in
the ledger. Drawer prose, source metadata, diagnostics, and Markdown must stay
within the viewport. Preformatted or unusually long description content uses
`white-space: pre-wrap`, `overflow-wrap: anywhere`, and a bounded scroll region
until expanded. Narrow layouts may make the ledger horizontally scrollable in
the same manner as the Tasks ledger, while the drawer remains bounded to the
viewport.

## Data and component boundaries

No core, data, operations, schema, migration, or HTTP API changes are required.

- The ledger consumes the existing position-list response, which already
  includes score, score explanation, company, location, and first-seen date.
- The drawer and Scout-description viewer consume the existing position-detail
  response.
- Decisions use the existing position decision and promotion-retry endpoints.
- Web components coordinate drawer/Agent-panel exclusivity through existing
  application UI state rather than domain state.

The implementation should extract focused web components rather than add more
branches to the already dense `GigScoutPage.tsx`: a review ledger, review
drawer, and reusable document-view presentation/route adapter.

## Error handling

- List and count refresh failures preserve the responsive local decision result
  but show a non-destructive refresh error and allow retry.
- Detail-loading failures leave the ledger visible and identify that the
  position could not be opened.
- Decision failures preserve the selected position and note.
- Description-view failures use the document viewer's bounded error state.
- Stale revision responses retain the current 409 behavior and prompt a detail
  refresh rather than silently submitting against a newer evaluation.

## Verification

Add deterministic component and browser coverage for:

- Tasks-style review rows and the reduced column set;
- row click closing the Agent panel and opening the review drawer;
- score and full score explanation presentation;
- optional blank and non-empty notes for Pursue and Mark irrelevant;
- Defer and promotion-retry behavior;
- controls disabled during submission;
- successful row removal without resetting scroll position;
- authoritative count/list refresh with filters, sort, and valid pagination
  preserved;
- decision failure preserving the row, drawer, and typed note;
- bounded text and Markdown at desktop and narrow widths;
- description expansion in the drawer;
- Scout Markdown in the reusable document view; and
- document-view Back behavior for opener, browser-history, and fallback cases.

Run the normal application check and build plus the complete dashboard E2E
suite. Use synthetic position and description fixtures only.

## Documentation

Update the Gig Scout product documentation to describe Positions as a
review-first ledger with subordinate processing diagnostics. No architecture
documentation or ADR changes are needed because package boundaries, domain
ownership, persistence, and API contracts do not change.

## Out of scope

- Relevance confidence or relevance-reason display
- Job-description normalization, including entity-encoded HTML tracked by #143
- New Scout decision semantics or state transitions
- New APIs, database columns, migrations, or managed-document creation
- Changes to Scout processing, queues, sourcing, or model prompts
- Redesigning Tasks, Networking, Gigs, or the Agent panel

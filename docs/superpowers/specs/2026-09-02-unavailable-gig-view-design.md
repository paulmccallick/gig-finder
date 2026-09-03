# Unavailable Gig View Design

**Issue:** [#153 — Remove unavailable Gigs from the Active board](https://github.com/paulmccallick/gig-finder/issues/153)

## Purpose

Gig Scout already records whether an official job posting is available. A trustworthy successful company scan marks an identified posting that is absent from the result as `unavailable`, but the Gig board currently ignores that state. Consequently, a role confirmed to be unavailable remains mixed with opportunities the candidate can still pursue.

Add a dedicated Unavailable view that removes these Gigs from Active without treating posting availability as a pipeline decision.

## Product behavior

The Gig board has three tabs:

- **Active** contains non-closed Gigs whose availability is `unknown` or `available`.
- **Unavailable** contains non-closed Gigs whose availability is `unavailable`.
- **Archive** contains closed Gigs regardless of their availability value.

Pipeline closure takes precedence over availability when choosing a view. An unavailable Gig that the user closes leaves Unavailable and appears in Archive. Changing availability never closes a Gig, changes its outcome, or deletes it.

If a later trustworthy Scout result marks the same Gig `available`, the existing record returns to Active in its retained pipeline stage. Its identity, history, documents, people, tasks, interactions, and Scout linkage remain unchanged.

Availability remains owned by Scout. The dashboard does not provide a manual availability toggle, and ordinary Gig updates do not bypass this boundary. A user may still ask the agent to perform an explicit pipeline action, such as closing an unavailable Gig with an appropriate non-pending outcome, through the existing audited Gig update capability.

## Unavailable view

Unavailable is a single chronological card list rather than a pipeline-column board. It is ordered by `availabilityUpdatedAt`, newest first. While a Gig is unavailable, that stored field is its explicit “became unavailable” timestamp; the view does not reconstruct the date from history.

Each card displays:

- The existing Gig identity and summary information needed to recognize the opportunity.
- Its retained pipeline stage.
- `Unavailable since …`, formatted from `availabilityUpdatedAt`.

Selecting a card opens the existing Gig drawer. The drawer continues to distinguish posting availability from pipeline stage and outcome.

The Unavailable tab displays its current record count. No additional dashboard summary tile is added.

## Filtering and state

The Unavailable view retains all existing Gig filters:

- Search
- Pipeline stage
- Fit
- Overdue only

Filters apply within the selected view and do not alter the view-membership rules. Counts and empty states reflect authoritative current dashboard data. Existing responsive and standalone layouts must expose the same records and controls.

When dashboard data refreshes after a Scout transition, the Gig moves between Active and Unavailable without duplication. A later explicit pipeline closure moves it to Archive. No client-side mutation is used to simulate either transition.

## Data and architecture

This change uses the existing `availability` and `availabilityUpdatedAt` fields on the Gig summary. It requires no schema change, migration, new persistence path, or history query.

Board-domain selection and ordering remain pure client-domain behavior. The dashboard UI consumes those results and reuses the existing card, drawer, filter, and refresh capabilities where practical. Scout remains the only writer of availability through the Gig domain.

## Error and edge behavior

- Failed, partial, unsupported, or suspiciously empty Scout results continue to leave availability unchanged.
- A closed Gig never appears in Active or Unavailable, even when its availability is `unknown`, `available`, or `unavailable`.
- An unavailable Gig with an existing next action may match the Overdue filter; its next action is not cleared automatically.
- `availabilityUpdatedAt` is required for the “Unavailable since” presentation of a current unavailable Gig. If legacy or inconsistent data lacks the timestamp, the UI must remain usable and show an explicit unavailable state without inventing a date.
- Search, stage, fit, and overdue filters compose using the existing filter semantics.

## Verification

Implementation follows test-driven development. Focused board-domain tests first demonstrate failures for:

- Active, Unavailable, and Archive membership, including closed-Gig precedence.
- Unknown and available Gigs remaining Active.
- Unavailable chronological ordering.
- Search, stage, fit, and overdue filtering within Unavailable.
- A missing unavailable timestamp remaining presentable without a fabricated date.

Browser regression coverage demonstrates:

- The Unavailable tab and its count.
- Removal of unavailable Gigs from Active.
- The chronological list, stage label, and “Unavailable since” presentation.
- Existing filters and drawer access in the new view.
- Authoritative refresh moving the same Gig between views after an availability transition.
- Responsive behavior consistent with the other Gig views.

Required completion gates are `bun run check`, `bun run build`, `bun run test:e2e`, and `git diff --check`.

## Out of scope

- A manual mark-available action.
- A new agent tool or batch-archive command.
- Automatic stage, outcome, next-action, or deletion changes caused by availability.
- Changing Scout result trust rules or posting-identity matching.
- Reconstructing prior availability periods from Gig history.
- Adding a dashboard summary tile for unavailable Gigs.

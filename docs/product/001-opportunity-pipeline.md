# FRR-001: Opportunity Pipeline

## 📋 Status

`Implemented`

## 🎯 Context & Problem

- **User Story**: As a candidate, I want one view of my opportunities so that I can focus on the next useful move and retain outcomes over time.
- **Current State**: The dashboard presents active gigs by pipeline stage and closed gigs in an archive grouped by outcome.
- **Why Now**: The opportunity pipeline is the organizing center for related people, tasks, and documents.

## 🛠️ Functional Specifications

- **Trigger**: The user opens Opportunities, selects active or archived work, changes a filter, or opens a gig.
- **Input Data**: Gig identity, company, role, stage, status, dates, location and work-mode details, compensation, notes, links, and related records where captured.
- **Happy Path**:
  1. The user searches or filters the pipeline and sees matching gigs grouped in a meaningful workflow order.
  2. The user opens a gig to review its details, application material, and related context.
- **Alternative Paths**:
  - No gigs match -> Explain that filters hid the results and offer a reset.
  - A gig closes -> Keep the same record and show it in the archive rather than copying or moving it.

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** active and closed gigs, **When** the user switches between pipeline and archive, **Then** each gig appears once in the appropriate view.
  - **Given** search or filter criteria, **When** the user applies them, **Then** summaries and visible groups describe the same result set.
- **Error Boundaries**: A data-load failure is explicit and does not present partial results as complete.
- **Data Validation**: Gig state uses the shared domain vocabulary and preserves record identity across lifecycle changes.

## 🛑 Out of Scope

- Submitting applications to an employer.
- Moving archived gigs into separate storage.

## 📈 Consequences & Impact

- **UX/UI Impact**: Opportunities provide the primary board, detail, urgency, filtering, and historical-outcome experience.
- **Data Model Changes**: None; this requirement describes the existing Gig and related-record contracts.
- **Performance Targets**: Search, filtering, and active/archive switching should feel immediate for a personal pipeline.

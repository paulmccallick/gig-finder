# FRR-006: Gig Scout

## 📋 Status

`Implemented`

## 🎯 Context & Problem

- **User Story**: As a candidate, I want one reliable scan of my chosen companies' official career sources so that I can discover relevant openings without manually revisiting every site.
- **Current State**: Gig Scout launches a durable full scan from private, versioned company and source configuration and retains run, company, position, and reconciliation outcomes.
- **Why Now**: Career sites vary widely and change often; discovery must distinguish verified results from incomplete, duplicated, or unsupported sourcing.

## 🛠️ Functional Specifications

- **Trigger**: The user launches a full scan from the Gig Scout workspace and later opens its progress or results.
- **Input Data**: Private target-company configuration, one authoritative official listing source per company, reusable generic source adapters, and candidate-specific search and exclusion criteria. Title criteria may configure boundary-aware equivalent variants. Positions retain their source display location plus all authoritative structured locations and explicit work arrangements. For the current release, Scout supplies temporary application defaults when a run omits or empties title terms or locations; a non-empty run dimension replaces its default.
- **Happy Path**:
  1. The system accepts one durable run and processes each configured company independently with bounded retries and concurrency.
  2. The resolved title and location profile is captured immutably with the run and applied to every company source.
  3. The user can follow durable progress and inspect accepted positions plus clear company and source outcomes after completion.
- **Alternative Paths**:
  - A source is verified empty -> Record success only when the source's explicit semantics and reconciliation support that conclusion.
  - A page fails, repeats prior results, or cannot be parsed reliably -> Preserve diagnostics and report a non-success outcome rather than silently omitting jobs.
  - The browser or application restarts -> Reconcile unfinished work without duplicating the logical run or its results.
- **Position Review**: The Positions workspace is a review-first ledger. Each row surfaces the candidate-match score, position, company/location, and first-seen date. Opening a row closes the Agent panel and uses the standard record drawer for an optional note and Pursue, Mark irrelevant, or Defer. Job descriptions and Scout processing diagnostics remain available as supporting detail; stored Scout Markdown can expand in the drawer or open in GigFinder's document view.
- **Description Normalization**: Configured JSON description fields are normalized to readable Markdown before Scout stores them or sends them to a screening model. Format and encoding are explicit source contracts, so entity-encoded HTML is decoded only for a configuration that declares it; raw or encoded provider descriptions are not retained as artifacts.
- **Explicit Position Reprocessing**: An operator may preview and start a bounded rerun for reviewed exact position IDs and a reason. The rerun preserves completed descriptions, evaluations, decisions, processing records, and managed-document versions as immutable history while replacing current projections only as each new stage succeeds. It refetches the official description and reruns reconciliation, relevance, and eligible candidate scoring.
- **Reprocessing Outcomes**: A corrected result previously marked irrelevant by the agent may return to `needs_user_review`. A promoted position remains promoted and absent from review; when its normalized description changes, the existing linked Gig and existing job-description document remain in place and the document receives one new immutable version. Unchanged Markdown does not create a duplicate version.

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** a configured full scan, **When** the initiating request ends, **Then** accepted work continues durably and remains observable.
  - **Given** a completed source attempt, **When** its outcome is marked successful, **Then** source-reported, received, parsed, evaluated, accepted, rejected, page-validation, and distinct-identity evidence reconciles.
  - **Given** repeated delivery or recovery, **When** a company job runs again, **Then** logical outcomes and stored descriptions are not duplicated.
  - **Given** normalized candidates from any JSON or DOM source, **When** title and location filters are active, **Then** Scout accepts a position only when its title matches a configured term or equivalent variant on normalized token boundaries and any authoritative location or explicit work arrangement matches the location profile; profile rejections remain reconciled diagnostics.
  - **Given** a source reports only an aggregate location label, **When** its underlying locations cannot be resolved within the bounded source request, **Then** Scout defers the location decision rather than rejecting the position as a false negative.
  - **Given** a trustworthy successful company result, **When** it is completed, **Then** Scout updates tracked Gig availability through the Gig domain.
  - **Given** a partial, failed, unsupported, or suspiciously empty company result, **When** it is completed, **Then** Scout does not update tracked Gig availability.
  - **Given** a Gig availability update, **When** Scout records it, **Then** it does not close the Gig or alter its pipeline stage or outcome.
  - **Given** a position awaiting review, **When** the user records a decision, **Then** only that row leaves the ledger, scroll position and active controls remain stable, and the list and counts refresh from authoritative state.
  - **Given** a position decision fails, **When** the server reports the failure, **Then** the row, drawer, optional note, and actionable error remain available.
  - **Given** a configured description field, **When** Scout acquires it, **Then** Scout stores and screens normalized Markdown rather than raw literal or entity-encoded HTML.
  - **Given** an explicit position rerun, **When** a replacement stage fails, **Then** its failure is retained and the prior successful current projection remains usable.
  - **Given** an agent-irrelevant position becomes relevant after reprocessing, **When** candidate scoring succeeds, **Then** the position returns to review with the new current evaluation.
  - **Given** a promoted position is reprocessed, **When** its normalized official description changes, **Then** it remains promoted and its existing Gig job-description document advances exactly one version.
- **Error Boundaries**: One company's exhaustion or unsupported source becomes an explicit company outcome and does not erase other companies' completed results.
- **Data Validation**: Only official configured sources are scanned; private targeting stays outside tracked adapters; accepted postings have real posting identity and application semantics. Remote, Work at Home, Work from Home, and home-based labels normalize to remote; hybrid and on-site require explicit source evidence, and a country label alone never implies remote. Attempt diagnostics retain normalized title, locations, arrangements, and title/location decisions. Accepted observation provenance binds both display and structured location values. Temporary default title terms are Director, Senior Director, Sr. Director, Senior Vice President, SVP, Vice President, VP Engineering, Head of Engineering, and Head of Technology. Default locations are Seattle, Bellevue, Redmond, Remote, and Washington.

## 🛑 Out of Scope

- Browser automation as a production sourcing method.
- Crawling arbitrary web search results or automatically adding discovered positions to the opportunity pipeline.

## 📈 Consequences & Impact

- **UX/UI Impact**: Gig Scout provides one launch point, durable run status, and a paged review ledger. Review decisions use the standard record drawer; operational diagnostics remain accessible without dominating the ledger.
- **Data Model Changes**: Source attempts persist normalized filter inputs and title/location decisions. Position observations preserve display and structured authoritative locations with normalized work arrangements.
- **Performance Targets**: Scans run outside request lifetime with bounded per-source work and host-safe concurrency; interactive progress reads remain responsive.

## Durable position processing

Scout keeps logical-position identity and observation deduplication separate
from durable per-position processing. Company jobs discover and persist
official-source results, while reconciliation, description acquisition,
relevance, and candidate scoring run independently and recover after restart.
[ADR 0014](../architecture/decisions/0014-separate-scout-discovery-from-position-processing.md)
defines this execution and state boundary.

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

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** a configured full scan, **When** the initiating request ends, **Then** accepted work continues durably and remains observable.
  - **Given** a completed source attempt, **When** its outcome is marked successful, **Then** source-reported, received, parsed, evaluated, accepted, rejected, page-validation, and distinct-identity evidence reconciles.
  - **Given** repeated delivery or recovery, **When** a company job runs again, **Then** logical outcomes and stored descriptions are not duplicated.
  - **Given** normalized candidates from any JSON or DOM source, **When** title and location filters are active, **Then** Scout accepts a position only when its title matches a configured term or equivalent variant on normalized token boundaries and any authoritative location or explicit work arrangement matches the location profile; profile rejections remain reconciled diagnostics.
  - **Given** a source reports only an aggregate location label, **When** its underlying locations cannot be resolved within the bounded source request, **Then** Scout defers the location decision rather than rejecting the position as a false negative.
- **Error Boundaries**: One company's exhaustion or unsupported source becomes an explicit company outcome and does not erase other companies' completed results.
- **Data Validation**: Only official configured sources are scanned; private targeting stays outside tracked adapters; accepted postings have real posting identity and application semantics. Remote, Work at Home, Work from Home, and home-based labels normalize to remote; hybrid and on-site require explicit source evidence, and a country label alone never implies remote. Attempt diagnostics retain normalized title, locations, arrangements, and title/location decisions. Accepted observation provenance binds both display and structured location values. Temporary default title terms are Director, Senior Director, Sr. Director, Senior Vice President, SVP, Vice President, VP Engineering, Head of Engineering, and Head of Technology. Default locations are Seattle, Bellevue, Redmond, Remote, and Washington.

## 🛑 Out of Scope

- Browser automation as a production sourcing method.
- Crawling arbitrary web search results or automatically adding discovered positions to the opportunity pipeline.

## 📈 Consequences & Impact

- **UX/UI Impact**: Gig Scout provides one launch point, durable run status, paged results, and actionable diagnostics rather than a synchronous scrape response.
- **Data Model Changes**: Source attempts persist normalized filter inputs and title/location decisions. Position observations preserve display and structured authoritative locations with normalized work arrangements.
- **Performance Targets**: Scans run outside request lifetime with bounded per-source work and host-safe concurrency; interactive progress reads remain responsive.

## 🔭 Planned position-processing extension

Issue #120 extends Scout without changing its existing logical-position
identity or observation deduplication. Company jobs will continue to discover
and persist official-source results. Durable processing of each logical
position will run independently so later Gig reconciliation, description
retrieval, and agent screening do not repeat per observation or delay company
completion. [ADR 0014](../architecture/decisions/0014-separate-scout-discovery-from-position-processing.md)
defines the proposed execution and state boundary.

# Product overview

GigFinder is a local-first workspace for managing a candidate's opportunity pipeline.

## User Experience

- The dashboard presents gigs, people, and tasks with search,
  filters, urgency signals, details, and captured job descriptions.
- The CLI reads and updates the same records and linked documents with audited mutations and
  non-persisting dry-run previews where available.
- The agent window uses the candidate profile; reads complete current gigs,
  people, gig-person relationships, tasks, interactions, and registered documents;
  creates gigs, people, gig-person relationships, tasks, interactions, and managed
  documents; updates supported records and documents; deletes interactions; and discovers managed
  document version history before reading an exact version.
- Named Profile context-document descriptions are always visible to the agent;
  it reads their versioned content on demand by document ID.
- The agent panel accepts DOCX, Markdown, and PDF source uploads, converts them
  locally to Markdown, and attaches a staged reference to the user's next
  message so the agent can determine what to do without altering the source.
- Successful managed-document reads appear inline in the conversation with
  friendly View and Download actions. View opens the selected authoritative
  version in a dedicated Markdown or plain-text window, and either location can
  download that exact version without exposing internal IDs.
- The light dashboard uses compact navigation and summaries; its agent workspace
  opens as a resizable side panel and can expand to fill the application without
  resetting the active session. Full-screen mode uses a narrow left rail for
  agent identity and workspace controls. Switching layouts preserves the
  mounted agent session and does not change agent or HTTP contracts.
- The agent header selects GPT-5.6 Sol, Terra, or Luna. The saved choice applies
  to the next request, survives restarts, and does not alter an active response.
- The agent supports multiple durable conversations, reopens the most recently
  active one, and lists the 20 most recently active conversations for switching.
- From submission through completion, the agent panel shows concise, accessible
  activity such as thinking, searching, reading, saving, and updating. It
  presents only provider-emitted reasoning, tool activity, and answer text in
  stream order, and restored conversations retain completed reasoning. Normal
  activity and responses use friendly names and action summaries rather than
  tool payloads or internal record, document, change, and call identifiers.
- Development uses `context/`; production uses isolated Unix state,
  configuration, log, and backup paths mounted into a local container built
  from the exact revision merged to GitHub.
- Gig Scout launches one durable full scan across the user's privately
  configured official career sources. Historical runs retain positions and a
  per-source reconciliation funnel: source-reported, received, parsed,
  evaluable, evaluated, accepted, rejected, page-validation, and distinct-page
  identity counts. A source cannot report verified success when those counts do
  not reconcile or a later page merely replays an earlier page.

## Entities

- **Candidate Profile:** The configured facts and search preferences used to
  personalize the agent; it owns context documents but is not itself a document.
- **Gig:** An opportunity moving through the candidate's pipeline that can be
  linked to people, tasks, and versioned managed documents. Gig details render
  the current linked managed job description, and Apply uses the Gig's current
  official posting URL.
- **Person:** An individual whose identity, relationship, priority, status,
  notes, tags, documents, and gig relationships share one record. Person reads
  include latest-contact details derived from Interactions; contact history and
  follow-up work are not writable Person state.
- **Gig-person relationship:** A typed connection between one gig and one person.
- **Task:** A job-search action related to a gig, person, or the
  search generally.
- **Interaction:** An immutable-history communication or encounter with one or
  more known people. It records kind, channel, direction, status, timing,
  optional gig association, source provenance, and supersession. Legacy
  Business Events remain intact and are not migrated or reconciled by the
  Interaction schema migration.

The existing Person status vocabulary still contains relationship workflow
labels that mention outreach. Those labels remain Person-owned grouping state
for compatibility; they do not record Interaction facts. Redesigning that
vocabulary is separate from the Person/Interaction contract separation.

- **Managed document:** Versioned Markdown or text linked to gigs, people, or
  the Candidate Profile. Person profiles link to exactly one person; Profile
  context documents link only to the Candidate Profile.

The archive is a dashboard view of closed gigs grouped by outcome; it does not
copy or move records into separate storage.

## Data ownership

Application source is generic. By default, a user's profile, operational
records, documents, logs, database, and backups live in the ignored `context/`
workspace.

Scout source URLs and tenant mechanics are private versioned company
configuration. Search terms, locations, exclusions, and other targeting inputs
belong to the private run-owned search profile. Tracked reusable JSON
configuration templates implement only public source mechanics and generic posting validation; they contain no
candidate-specific title, seniority, location, or remote-work assumptions.
Each current company configuration has exactly one active authoritative
official listing source. Reusable template definitions own pagination mechanics;
search variants do not create duplicate or fallback source rows.
A reusable template is accepted only when every privately configured company using it
passes live reconciliation, real-posting semantics, and applicable pagination
checks. Custom DOM HTML and unique JSON sources are reported separately for an
explicit repair, configuration, or exclusion decision.
Custom server-rendered HTML is extracted from privately configured DOM
selectors without browser execution. A listing surface is verified empty only
when an explicit empty-state selector matches; empty containers and
JavaScript-only shells remain suspicious or unsupported.
Structured JSON embedded in a server-returned script block uses the generic
JSON source adapter; HTML regular-expression sourcing is unsupported.

Gig and person records include document IDs, types, optional titles, and
friendly display names; person detail also includes related gig IDs and
relationship types. User interfaces display document names rather than IDs.

Profile context documents require a name and may include a 255-character
description. SQLite is authoritative; current Markdown in the configured
private Profile-document directory is a repairable projection.

Core application services own client-neutral domain contracts, validation,
lifecycle behavior, audit semantics, and results. The CLI and agent are adapters
over those contracts and do not maintain independent domain rules.

Agent tools cannot delete gigs, people, tasks, relationships, or managed
documents, perform operator artifact maintenance, read or write legacy
Business Events, or access arbitrary files, email, calendars, or external services.
Agent mutations are audited and idempotent. Eligible creations and updates can
be reverted when no later edit or dependent record would be overwritten or
orphaned.

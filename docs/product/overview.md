# Product overview

GigFinder is a local-first workspace for managing a candidate's opportunity pipeline.

## User Experience

- The dashboard presents gigs, people, and tasks with search,
  filters, urgency signals, details, and captured job descriptions.
- The CLI reads and updates the same records and linked documents with audited mutations and
  non-persisting dry-run previews where available.
- The agent window uses the candidate profile; reads complete current gigs,
  people, gig-person relationships, tasks, meetings, and registered documents;
  creates gigs, people, gig-person relationships, tasks, meetings, and managed
  documents; updates supported records and documents; and discovers managed
  document version history before reading an exact version.
- Named Profile context-document descriptions are always visible to the agent;
  it reads their versioned content on demand by document ID.
- The agent panel accepts DOCX, Markdown, and PDF source uploads, converts them
  locally to Markdown, and attaches a staged reference to the user's next
  message so the agent can determine what to do without altering the source.
- The light dashboard uses compact navigation and summaries; its agent workspace
  opens as a resizable side panel and can expand to fill the application without
  resetting the active session. Full-screen mode uses a narrow left rail for
  agent identity and workspace controls.
- The agent header selects GPT-5.6 Sol, Terra, or Luna. The saved choice applies
  to the next request, survives restarts, and does not alter an active response.
- The agent supports multiple durable conversations, reopens the most recently
  active one, and lists the 20 most recently active conversations for switching.
- Development uses `context/`; production uses isolated Unix state,
  configuration, log, and backup paths mounted into a local container built
  from the exact revision merged to GitHub.

## Entities

- **Candidate Profile:** The configured facts and search preferences used to
  personalize the agent; it owns context documents but is not itself a document.
- **Gig:** An opportunity moving through the candidate's pipeline that can be
  linked to people, tasks, registered artifacts, and versioned managed
  documents.
- **Person:** An individual whose identity, relationship, priority, status,
  outreach, notes, tags, documents, gigs, and meetings share one record.
- **Gig-person relationship:** A typed connection between one gig and one person.
- **Task:** A job-search action related to a gig, person, or the
  search generally.
- **Meeting:** A scheduled or completed interaction with one or more people
  that may be associated with a gig.
- **Managed document:** Versioned Markdown or text linked to gigs, people, or
  the Candidate Profile; Person profiles link to exactly one person, while
  registered legacy Gig descriptions and interview-prep files are imported as
  version-one managed documents during rollout without deleting the source
  files.
  Profile context documents link only to the Candidate Profile.

The archive is a dashboard view of closed gigs grouped by outcome; it does not
copy or move records into separate storage.

## Data ownership

Application source is generic. By default, a user's profile, operational
records, documents, logs, database, and backups live in the ignored `context/`
workspace.

Gig and person records include document IDs, types, optional titles, and
friendly display names; person detail also includes related gig IDs and
relationship types. User interfaces display document names rather than IDs.

Profile context documents require a name, may include a 255-character
description, and store their current Markdown file in the configured private
Profile-document directory while SQLite remains authoritative.

Core application services own client-neutral domain contracts, validation,
lifecycle behavior, audit semantics, and results. The CLI and agent are adapters
over those contracts and do not maintain independent domain rules.

Agent tools cannot delete gigs, people, tasks, relationships, or managed
documents, perform operator artifact maintenance, read or write Business
Events, or access arbitrary files, email, calendars, or external services.
Agent mutations are audited and idempotent. Eligible creations and updates can
be reverted when no later edit or dependent record would be overwritten or
orphaned. The agent verifies the intended change with the user before mutating
records or documents.

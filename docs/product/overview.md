# Product overview

GigFinder is a local-first workspace for managing a candidate's opportunity pipeline.

## User Experience

- The dashboard presents gigs, networking contacts, and tasks with search,
  filters, urgency signals, details, and captured job descriptions.
- The CLI reads and updates the same records and linked documents with audited mutations and
  non-persisting dry-run previews where available.
- The agent window uses the candidate profile; reads complete current gigs,
  people, networking contacts, gig-person relationships, tasks, and registered
  meetings and documents; updates existing gigs and contacts; and manages
  documents.
- The agent panel accepts DOCX, Markdown, and PDF source uploads, converts them
  locally to Markdown, and attaches a staged reference to the user's next
  message so the agent can determine what to do without altering the source.
- Agent conversations last only for the current page load.

## Entities

- **Gig:** An opportunity moving through the candidate's pipeline that can be
  linked to people, tasks, registered artifacts, and versioned managed
  documents.
- **Person:** A canonical individual whose optional managed profile document
  can be linked to gigs and whose relationship is extended by networking activity.
- **Networking contact:** The candidate's relationship, priority, status, and
  outreach state for one person.
- **Gig-person relationship:** A typed connection between one gig and one person.
- **Task:** A job-search action related to a gig, networking contact, or the
  search generally.
- **Meeting:** A scheduled or completed interaction with one or more people
  that may be associated with a gig.
- **Managed document:** Versioned Markdown or text linked to gigs and people;
  profiles link to exactly one person and may also link to gigs.

The archive is a dashboard view of closed gigs grouped by outcome; it does not
copy or move records into separate storage.

## Data ownership

Application source is generic. By default, a user's profile, operational
records, documents, logs, database, and backups live in the ignored `context/`
workspace.

Gig and networking-contact records include document IDs, types, optional titles,
and friendly display names; contact detail also includes related gig IDs and
relationship types. User interfaces display document names rather than IDs.

Agent tools cannot create or delete gigs, contacts, or tasks, delete managed documents,
or access arbitrary files, history, email, calendars, or external
services. Agent mutations are audited; gig and contact updates can be reverted
when no later edit would be overwritten. The agent verifies the intended change
with the user before mutating records or documents.

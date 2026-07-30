# Product overview

Job Search Agent is a local-first workspace for running a job search.

## User Experience

- The dashboard presents jobs, networking contacts, and tasks with search,
  filters, urgency signals, details, and captured job descriptions.
- The CLI reads and updates the same records and linked documents with audited mutations and
  non-persisting dry-run previews where available.
- The agent window uses the candidate profile; reads complete current jobs,
  people, networking contacts, job-person relationships, tasks, and registered
  documents; updates existing jobs and contacts; and manages documents.
- The agent panel accepts DOCX, Markdown, and PDF source uploads, converts them
  locally to Markdown, and attaches a staged reference to the user's next
  message so the agent can determine what to do without altering the source.
- Agent conversations last only for the current page load.

## Entities

- **Job:** An opportunity moving through the candidate's pipeline that can be
  linked to people, tasks, registered artifacts, and versioned managed
  documents.
- **Person:** A canonical individual whose optional managed profile document
  can be linked to jobs and whose relationship is extended by networking activity.
- **Networking contact:** The candidate's relationship, priority, status, and
  outreach state for one person.
- **Task:** A job-search action related to a job, networking contact, or the
  search generally.
- **Meeting:** A scheduled interaction that can reference a related job or
  networking contact.
- **Managed document:** Versioned Markdown or text linked to jobs and people;
  profiles link to exactly one person and may also link to jobs.

The archive is a dashboard view of closed jobs grouped by outcome; it does not
copy or move records into separate storage.

## Data ownership

Application source is generic. By default, a user's profile, operational
records, documents, logs, database, and backups live in the ignored `context/`
workspace.

Job and networking-contact records include document IDs, types, optional titles,
and friendly display names; contact detail also includes related job IDs and
relationship types. User interfaces display document names rather than IDs.

Agent tools cannot create or delete jobs, contacts, or tasks, delete managed documents,
or access arbitrary files, meetings, history, email, calendars, or external
services. Agent mutations are audited; job and contact updates can be reverted
when no later edit would be overwritten. The agent verifies the intended change
with the user before mutating records or documents.

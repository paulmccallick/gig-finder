# Product overview

Job Search Agent is a local-first workspace for running a job search.

## User Experience

- The dashboard presents jobs, networking contacts, and tasks with search,
  filters, urgency signals, details, and captured job descriptions.
- The CLI reads and updates the same records with audited mutations and
  non-persisting dry-run previews where available.
- The agent window uses the candidate profile, reads current records and
  registered documents, updates existing jobs and contacts, and creates or
  revises managed job documents.
- Agent conversations last only for the current page load.

## Entities

- **Job:** An opportunity moving through the candidate's pipeline that can be
  linked to people, tasks, registered artifacts, and versioned managed
  documents.
- **Person:** A canonical individual and optional profile that can be linked to
  jobs and extended with networking activity.
- **Networking contact:** The candidate's relationship, priority, status, and
  outreach state for one person.
- **Task:** A job-search action related to a job, networking contact, or the
  search generally.
- **Meeting:** A scheduled interaction that can reference a related job or
  networking contact.

The archive is a dashboard view of closed jobs grouped by outcome; it does not
copy or move records into separate storage.

## Data ownership

Application source is generic. By default, a user's profile, operational
records, documents, logs, database, and backups live in the ignored `context/`
workspace.

Agent tools cannot create or delete jobs, contacts, or tasks, delete documents,
or access arbitrary files, meetings, history, email, calendars, or external
services. Agent mutations are audited; job and contact updates can be reverted
when no later edit would be overwritten.

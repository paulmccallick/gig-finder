# Agent tool contracts

JobSearchAgent has eight read tools and five mutation tools.

| Tool | Contract |
| --- | --- |
| `list_jobs` | Lists job summaries; filters by stage, outcome, fit, overdue state, and text. |
| `get_job` | Returns one complete job, compact managed-document summaries, and transitional artifact references. |
| `list_networking_contacts` | Lists contact summaries; filters by status, priority, relationship strength, overdue state, and text. |
| `get_networking_contact` | Returns one complete contact, its person ID, managed-profile availability, and compact managed-document summaries. |
| `list_tasks` | Lists tasks; filters by status, priority, type, related entity, overdue state, and text. |
| `get_task` | Returns one complete task. |
| `get_document` | Resolves an exact registered or staged document reference. |
| `search_jobs_and_contacts` | Resolves company or person names to existing jobs and contacts, ignoring punctuation and case. |
| `update_job` | Updates mutable fields on one existing job. |
| `update_networking_contact` | Atomically updates mutable person and networking fields for one contact. |
| `create_document` | Creates a versioned document linked to existing jobs and/or people from inline content or an exact staged reference. |
| `update_document` | Replaces a managed document's current content while preserving prior versions. |
| `revert_change` | Reverts one eligible change unless a later revision exists. |

## List behavior

Enum-list filters use OR within a field and AND across fields. Scalar filters
cover text, overdue state, and task relationships. Enum values come from the
domain constants in `src/core` for enum-list filters. Results use deterministic
urgency ordering.

With no filters, jobs default to `applied`, `recruiter_contact`, `screening`,
and `technical_interview`; contacts to `active_relationship`; and tasks to
`open` or `in_progress`. Supplying a meaningful non-default filter broadens an
unprovided job `stages`, contact `statuses`, or task `statuses` field to all
accepted values. `overdueOnly: false` and an empty query do not broaden it.

Text search is case-insensitive. Jobs search company, title, status summary,
and next action; contacts search name, company, title, and why-interesting;
tasks search title, related-entity label, and notes.

Pagination defaults to `offset: 0` and `limit: 20`; the maximum limit is 50.
Responses include totals and the next offset.

## Model-facing schema

Read tools use strict JSON schemas. List properties are required and nullable so the
model can leave individual filters unused. Each property carries its own
description; enum-valued properties use domain-derived values.

Job and contact tools use structurally strict operation lists. Field and value
descriptions enumerate accepted domain values; the agent adapter translates
operations into, and validates them against, the update schemas in
`src/core/src/update-contracts.ts`. The CLI uses those core schemas directly.
See [ADR 0001](decisions/0001-agent-update-contracts.md).

Document tools use strict, domain-enum-backed schemas. Text creation accepts
nonempty job/person links, type, nullable title, media type, source description,
and a discriminated source containing either inline content or a staged
reference; invalid source combinations are not representable. Profiles require
exactly one person link and may also link to jobs. Updates accept
an exact managed-document ID, expected current version, replacement content,
and change summary. They return links, the document ID, current version,
content hash, change ID, and whether content changed; identical content is a
successful no-op. Managed IDs and `get_document` results also expose the
current version needed for a later update. Job and contact records expose
`documents` entries containing `id`, `type`, nullable `title`, and a required
friendly `displayName`.
The display name is the explicit title, otherwise the uploaded filename,
otherwise a friendly label for the document type.

Successful job and contact updates return the persisted record and change ID.
The tool-call ID makes updates idempotent. Reverts create new history and reject
later-revision conflicts. Failures distinguish validation, not found,
duplicate, conflict, non-revertible, and unexpected errors. Documents are
limited to 50,000 characters. Managed document reads return current content;
their version history remains immutable.

## Source uploads

The web API accepts DOCX, Markdown, and PDF files within configured byte, page,
extracted-character, and DOCX uncompressed-byte limits. It validates the
extension, declared media type, file signature, DOCX central directory, and
provenance; converts content deterministically to Markdown; and stages it in
bounded memory for 15 minutes by default. The binary is not persisted.
The Bun server enforces a hard request-body cap even when `Content-Length` is
missing or incorrect.

Staging does not invoke the agent. The panel retains the upload as an attachment
and adds only its staged reference to the user's next message. The agent can
read it with `get_document`, determine an appropriate action, and use
`search_jobs_and_contacts` when names need resolution; that core service
composes the existing job and contact list searches. If context is ambiguous,
the agent asks one targeted question. `create_document` resolves staged content
server-side, preserving its filename, detected media type, source hash,
converter/version, warnings, and upload time. Saved uploads cannot be changed
with `update_document`. A successful save records its result against the staged
reference so retries do not duplicate the document; staging is discarded only
after browser acknowledgement or expiry.

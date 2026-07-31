# Agent tool contracts

GigFinderAgent has fourteen read tools and seven mutation tools.

| Tool | Contract |
| --- | --- |
| `list_gigs` | Lists complete gigs; filters by stage, outcome, fit, overdue state, and text. |
| `get_gig` | Returns the same complete gig fields as `list_gigs`, including document references. |
| `list_networking_contacts` | Lists complete contact records; filters by status, priority, relationship strength, overdue state, and text. |
| `get_networking_contact` | Returns one complete contact, its Person fields, compact document summaries, and related gig IDs with relationship types. |
| `list_people` | Lists complete canonical people, including people without Networking Contact state; filters by text. |
| `get_person` | Returns one canonical Person by person ID. |
| `list_gig_person_relationships` | Lists Gig-Person Relationships; filters by multiple gig IDs, person IDs, and relationship values. |
| `get_gig_person_relationship` | Returns one Gig-Person Relationship by relationship ID. |
| `list_tasks` | Lists complete tasks; filters by status, priority, type, related entity, overdue state, and text. |
| `get_task` | Returns one complete task. |
| `list_meetings` | Lists complete meetings; filters by multiple person IDs, gig IDs, statuses, inclusive start timestamps, and text. |
| `get_meeting` | Returns one complete meeting with every participant person ID and its optional gig ID. |
| `get_document` | Resolves an exact registered or staged document reference. |
| `search_gigs_and_contacts` | Resolves company or person names to existing gigs and contacts, ignoring punctuation and case. |
| `update_gig` | Updates mutable fields on one existing gig. |
| `update_networking_contact` | Atomically updates mutable person and networking fields for one contact. |
| `create_meeting` | Creates a meeting linked to one or more existing people and optionally one existing gig. |
| `update_meeting` | Updates mutable fields and the complete participant list of one existing meeting. |
| `create_document` | Creates a versioned document linked to existing gigs and/or people from inline content or an exact staged reference. |
| `update_document` | Replaces a managed document's current content while preserving prior versions. |
| `revert_change` | Reverts one eligible change unless a later revision exists. |

## List behavior

Enum-list filters use OR within a field and AND across fields. Scalar filters
cover text, overdue state, and task relationships. Enum values come from the
domain constants in `src/core` for enum-list filters. Results use deterministic
urgency ordering.

With no filters, gigs default to `applied`, `recruiter_contact`, `screening`,
and `technical_interview`; contacts to `active_relationship`; and tasks to
`open` or `in_progress`. Supplying a meaningful non-default filter broadens an
unprovided gig `stages`, contact `statuses`, or task `statuses` field to all
accepted values. `overdueOnly: false` and an empty query do not broaden it.

Text search is case-insensitive. Gigs search company, title, status summary,
and next action; contacts search name, company, title, and why-interesting;
people search name, company, and title; tasks search title, related-entity
label, and notes; meetings search title, location, and description. People,
relationship, and meeting lists default to all current records; meetings are
ordered by start time descending.

Relationship filters use OR within gig IDs, person IDs, or relationship values
and AND across those fields. Accepted values are `interviewer`,
`hiring_manager`, `recruiter`, `recruiting_coordinator`, `employee`, `former_peer`,
`professional_contact`, and `personal_contact`.
Records return relationship, gig, and person IDs; the corresponding get tools
return the complete linked entities.

Meeting person-ID and gig-ID filters use OR within each field and AND across
fields. Start bounds are inclusive and compare ISO timestamps as absolute
instants. Accepted statuses are `confirmed` and `completed`.

Pagination defaults to `offset: 0` and `limit: 20`; the maximum limit is 50.
Responses include totals and the next offset.

## Model-facing schema

Read tools use strict JSON schemas. List properties are required and nullable so the
model can leave individual filters unused. Each property carries its own
description; enum-valued properties use domain-derived values.

List and get return the same domain fields for each entity; contact detail adds
compact related-gig references. Networking Contact records expose both the
contact ID and canonical `personId`; People do not need Networking Contact
state. Missing records return `not_found`, while stored relationships with
missing links or unsupported values return a distinct `consistency_error`
without leaking private record contents to logs.
`get_networking_contact` additionally returns every related gig as `gigId` and
`relationship`; its embedded Person fields make a follow-up `get_person` call
unnecessary.
Meeting records expose `personIds` from the versioned participant join and a
nullable `gigId`; missing links and meetings without participants return
`consistency_error`.

Gig, contact, and meeting update tools use structurally strict operation lists. Field and value
descriptions enumerate accepted domain values; the agent adapter translates
operations into, and validates them against, the update schemas in
`src/core/src/update-contracts.ts`. The CLI uses those core schemas directly.
See [ADR 0001](decisions/0001-agent-update-contracts.md).

`create_meeting` requires title, offset-bearing start and end timestamps,
timezone, a domain-derived status, and one or more unique Person IDs. Nullable
Gig ID, location, and description properties remain present for strict-schema
compatibility. The server generates the Meeting ID and leaves external-calendar
identifiers unset. `update_meeting` supports title, timestamps, timezone,
status, participant Person IDs, Gig ID, location, and description. Setting
`personIds` replaces the complete participant list; Gig ID, location, and
description can be cleared. Meeting and participant changes are atomic.

Document tools use strict, domain-enum-backed schemas. Text creation accepts
nonempty gig/person links, type, nullable title, media type, source description,
and flat source-kind, content, and reference fields. Inline content requires
content and a null reference; staged content requires a null content field, an
exact staged reference, and Markdown media type. These combinations are
validated locally because the provider's strict tool-schema subset rejects
nested JSON Schema unions. Profiles require
exactly one person link and may also link to gigs. Updates accept
an exact managed-document ID, expected current version, replacement content,
and change summary. They return links, the document ID, current version,
content hash, change ID, and whether content changed; identical content is a
successful no-op. Managed IDs and `get_document` results also expose the
current version needed for a later update. Gig and contact records expose
`documents` entries containing `id`, `type`, nullable `title`, and a required
friendly `displayName`.
The display name is the explicit title, otherwise the uploaded filename,
otherwise a friendly label for the document type.

Successful gig, contact, and meeting mutations return the persisted record and change ID.
The agent verifies the intended change with the user before invoking a mutation.
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
`search_gigs_and_contacts` when names need resolution; that core service
composes the existing gig and contact list searches. If context is ambiguous,
the agent asks one targeted question. `create_document` resolves staged content
server-side, preserving its filename, detected media type, source hash,
converter/version, warnings, and upload time. Saved uploads cannot be changed
with `update_document`. A successful save records its result against the staged
reference so retries do not duplicate the document; staging is discarded only
after browser acknowledgement or expiry.

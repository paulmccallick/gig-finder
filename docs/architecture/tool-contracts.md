# Agent tool contracts

GigFinderAgent has fourteen read tools and twelve mutation tools.

| Tool | Contract |
| --- | --- |
| `list_gigs` | Lists complete gigs; filters by stage, outcome, fit, overdue state, and text. |
| `get_gig` | Returns the same complete gig fields as `list_gigs`, including document references. |
| `list_people` | Lists complete people; filters by status, priority, relationship strength, overdue state, and text. |
| `get_person` | Returns one complete Person with document summaries and related gig IDs and relationship types. |
| `list_gig_person_relationships` | Lists Gig-Person Relationships; filters by multiple gig IDs, person IDs, and relationship values. |
| `get_gig_person_relationship` | Returns one Gig-Person Relationship by relationship ID. |
| `list_tasks` | Lists complete tasks; filters by status, priority, type, related entity, overdue state, and text. |
| `get_task` | Returns one complete task. |
| `list_meetings` | Lists complete meetings; filters by multiple person IDs, gig IDs, statuses, inclusive start timestamps, and text. |
| `get_meeting` | Returns one complete meeting with every participant person ID and its optional gig ID. |
| `list_documents` | Lists registered managed and legacy document references for exactly one Gig, Person, or candidate Profile owner, with bounded pagination. |
| `list_document_versions` | Lists bounded immutable metadata for versions of one exact managed document so the agent can select a version for `get_document`. |
| `get_document` | Resolves an exact registered or staged document reference. |
| `search_gigs_and_people` | Resolves company or person names to existing gigs and people, ignoring punctuation and case. |
| `create_gig` | Creates one pipeline Gig using the client-neutral core creation contract and an application-generated ID. |
| `update_gig` | Updates mutable fields on one existing gig. |
| `create_person` | Creates one canonical Person using the client-neutral core creation contract and an application-generated ID. |
| `update_person` | Updates mutable identity, relationship, and outreach fields on one Person. |
| `create_gig_person_relationship` | Creates one typed relationship between an exact existing Gig and Person using an application-generated ID. |
| `create_task` | Creates a task related to an existing Gig, Person, or the general search. |
| `update_task` | Updates mutable fields on one existing task. |
| `create_meeting` | Creates a meeting linked to one or more existing people and optionally one existing gig. |
| `update_meeting` | Updates mutable fields and the complete participant list of one existing meeting. |
| `create_document` | Creates a versioned document linked to existing gigs, people, or the candidate Profile from inline content or an exact staged reference. |
| `update_document` | Replaces a managed document's current content while preserving prior versions. |
| `revert_change` | Reverts one eligible change unless a later revision exists. |

## List behavior

Enum-list filters use OR within a field and AND across fields. Scalar filters
cover text, overdue state, and task relationships. Enum values come from the
domain constants in `src/core` for enum-list filters. Results use deterministic
urgency ordering.

With no filters, gigs default to `applied`, `recruiter_contact`, `screening`,
and `technical_interview`; tasks default to `open` or `in_progress`; people
default to all current records. Supplying another gig or task filter broadens
an unprovided `stages` or `statuses` field to all accepted values.

Text search is case-insensitive. Gigs search company, title, status summary,
and next action; people search name, company, title, and why-interesting;
tasks search title, related-entity
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

Document discovery accepts exactly one owner type and ID. Gig and Person owners
must exist; the Profile owner is the canonical candidate Profile. Results
contain registered discovery metadata only and never arbitrary paths or
document content. Managed-document version discovery returns immutable metadata
in deterministic newest-first order. Staged documents and legacy artifacts do
not expose version lists.

## Model-facing schema

Read tools use strict JSON schemas. List properties are required and nullable so the
model can leave individual filters unused. Each property carries its own
description; enum-valued properties use domain-derived values.

CI validates every registered model-facing tool schema. Recursively, each
object reachable through properties, arrays, nullable alternatives, schema
combinators, definitions, or local references must set
`additionalProperties: false` and require exactly its declared properties.
Registry/runtime parity tests cover both read-only and mutation-enabled tool
sets, and an AI SDK boundary test verifies the emitted schemas that reach the
model. Test validation failures identify only the tool, schema path, and rule;
they do not include full schemas, prompts, or record content. Production does
not perform this development-time contract assertion.

List and get return the same domain fields for each entity; Person detail adds
compact related-gig references. Missing records return `not_found`, while stored relationships with
missing links or unsupported values return a distinct `consistency_error`
without leaking private record contents to logs.
`get_person` additionally returns every related gig as `gigId` and
`relationship`.
Meeting records expose `personIds` from the versioned participant join and a
nullable `gigId`; missing links and meetings without participants return
`consistency_error`.

Gig, Person, task, and meeting update tools use structurally strict operation lists. Field and value
descriptions enumerate accepted domain values; the agent adapter translates
operations into, and validates them against, the entity-owned input schemas in
`src/core/gigs.ts`, `people.ts`, `tasks.ts`, and `meetings.ts`. The CLI adapts
its JSON and flags to those same contracts. See
[ADR 0001](decisions/0001-agent-update-contracts.md) and
[ADR 0004](decisions/0004-share-domain-input-contracts.md).

Gig, Person, Gig-Person relationship, task, and meeting creation use
client-neutral, entity-owned core input contracts shared with update behavior
and the CLI. Core owns required fields, defaults, enum values,
relationship validation, uniqueness, and lifecycle invariants. The agent adapts
those inputs to strict model-facing schemas and generates entity-prefixed UUIDs;
the CLI adapts its flags and explicit command ID to the same core operations.
Neither adapter maintains independent domain validation or enum lists.
When a provider requires all properties at every object level, the agent adapter
projects optional core fields as required nullable values and makes nested
objects complete. This does not make those fields required in the shared domain
contract or in other clients such as the CLI.
Provider-unsupported JSON Schema formats are likewise omitted from model-facing
projections; core still validates the corresponding domain value before write.

Managed-document metadata follows the same entity-owned input-contract pattern.
Replacing document content remains a distinct versioned command because it is
an optimistic-concurrency boundary that creates an immutable prior version; it
is not a second general-purpose metadata patch path.

`create_meeting` requires title, offset-bearing start and end timestamps, a
valid IANA timezone, a domain-derived status, and one or more unique Person IDs. Nullable
Gig ID, location, and description properties remain present for strict-schema
compatibility. The server generates the Meeting ID and leaves external-calendar
identifiers unset. `update_meeting` supports title, timestamps, timezone,
status, participant Person IDs, Gig ID, location, and description. Setting
`personIds` replaces the complete participant list; Gig ID, location, and
description can be cleared. Meeting and participant changes are atomic.
Meeting updates can be reverted when no later edit would be overwritten.

`create_task` requires a title, domain-derived type, optional priority and nullable due
date, a complete Gig/Person/general relationship, and nullable notes. The
server generates its ID and dates, defaults omitted priority to medium, and derives
the relationship label from the linked record. Dates must be calendar-valid and
task lifecycle dates use the Pacific business date. `update_task` supports title,
type, status, priority, due date, relationship, and notes; due date and notes
can be cleared. Completing a task records the server date, while reopening or
canceling clears the completion date.

Document tools use strict, domain-enum-backed schemas. Text creation accepts
nonempty Gig/Person/Profile links, type, nullable title and description, media
type, source description, and flat source-kind, content, and reference fields. Inline content requires
content and a null reference; staged content requires a null content field, an
exact staged reference, and Markdown media type. These combinations are
validated locally because the provider's strict tool-schema subset rejects
nested JSON Schema unions. Person profile documents require exactly one Person
link and may also link to Gigs. Profile context documents link only to Profile
`candidate`, require a name, reject the Person-profile document type, and may
store a description of up to 255 characters. Their names, IDs, types, versions,
and descriptions are serialized as untrusted discovery metadata in system
context; content remains available on demand through `get_document`. Updates accept
an exact managed-document ID, expected current version, replacement content,
and change summary. They return links, the document ID, current version,
content hash, change ID, and whether content changed; identical content is a
successful no-op. Managed IDs and `get_document` results also expose the
current version needed for a later update. `get_document` accepts a nullable
positive version; null reads current content, while an explicit managed version
supports comparisons without placing historical document content in chat
storage. When a hydrated historical result reports a newer `currentVersion`,
the agent chooses whether historical fidelity or current content fits the
request and rereads with a null version when freshness matters. Gig and Person records expose
`documents` entries containing `id`, `type`, nullable `title`, and a required
friendly `displayName`.
The display name is the explicit title, otherwise the uploaded filename,
otherwise a friendly label for the document type.

`list_documents` returns managed and registered legacy references for one exact
owner with totals and next-offset metadata. `list_document_versions` accepts an
exact managed-document ID and returns bounded metadata such as version, media
type, content hash, provenance, and creation information; content remains
available only through `get_document`. Missing owners and documents and
unsupported version sources use explicit bounded results.
During rollout, the maintenance migration imports registered legacy Gig
job-description and interview-prep Markdown into managed version-one documents.
The mixed reader remains available during migration and the CLI returns its
mixed result unchanged, so discovery does not lose legacy visibility before a
successful import.

Successful Gig, Person, Gig-Person relationship, task, and meeting mutations
return the persisted record and change ID.
The agent verifies the intended change with the user before invoking a mutation.
The tool-call ID makes updates idempotent. Creation retries are accepted only
when both the durable record ID and normalized domain payload match the
original write; reused change IDs with different payloads return a conflict.
Reverts create new history and reject
later-revision conflicts. Creation reversion is available only where the core
can prove no later edit or dependent record would be overwritten or orphaned.
Gig-Person relationship creation is reversible because reverting it only
soft-deletes that leaf relationship at its original revision. Gig and Person
creation are non-revertible: either record can acquire dependent relationships,
tasks, meetings, or documents, and the generic reverter does not cascade or
orphan those records.
Relationship tuple uniqueness applies only to active records, allowing the same
Gig, Person, and relationship type to be recreated under a new ID after its
prior creation is reverted.
Failures distinguish validation, not found,
duplicate, conflict, non-revertible, and unexpected errors. Documents are
limited to 50,000 characters. Managed document version history remains immutable.

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
`search_gigs_and_people` when names need resolution; that core service
composes the existing Gig and Person list searches. Profile-owned uploads use
the same flow and materialize as Markdown beneath the configured private
Profile-document directory. SQLite records the materialized version so failed
writes can be retried without replaying the mutation. If context is ambiguous,
the agent asks one targeted question. `create_document` resolves staged content
server-side, preserving its filename, detected media type, source hash,
converter/version, warnings, and upload time. Saved uploads cannot be changed
with `update_document`. A successful save records its result against the staged
reference so retries do not duplicate the document; staging is discarded only
after browser acknowledgement or expiry.

# ADR 0016: Mutate domain-owned tables through the owning domain service

**Status:** Accepted
**Date:** 2026-08-27

## Context

Revision and audit transactions are insufficient when another domain or its
persistence adapter reproduces a domain mutation directly. That bypass can
omit validation, history, or related invariants while appearing successful.

## Decision

- Each mutable table has one owning domain.
- Mutations enter through that domain's service and its repository ports.
- Another domain requests a capability from the owning service; it does not
  reproduce SQL, revision, history, or audit behavior.
- Persistence adapters implement storage for their own domain and do not
  orchestrate another domain's service.
- Read-only cross-domain access requires an explicit read contract and does
  not grant mutation ownership.
- Dependency-cruiser enforces detectable service-module boundaries; tests and
  review cover semantic bypasses such as duplicated SQL.

The current ownership map is:

| Domain | Owned tables |
| --- | --- |
| Change audit | `changes`, `creation_idempotency` |
| Application settings | `application_settings` |
| Conversations | `conversations`, `conversation_history`, `conversation_messages` |
| Gigs | `gigs`, `gig_history` |
| People and Gig relationships | `people`, `person_history`, `gig_people`, `gig_people_history`, `legacy_person_follow_up_archive` |
| Tasks | `tasks`, `task_history` |
| Interactions | `interactions`, `interaction_history`, `interaction_participants`, `interaction_participant_history`, `interaction_sources`, `interaction_legacy_refs` |
| Business events | `business_events`, `event_sources` |
| Managed documents and candidate profile | `managed_documents`, `managed_document_versions`, `managed_document_links`, `candidate_profiles` |
| Scout | every `scout_*` table except foreign-key references to another domain's rows |

New mutable tables must be assigned to an owning domain in this ADR or in a
later ADR that amends this map.

## Consequences

- Cross-domain workflows are orchestrated in core services.
- Composition roots wire services and ports without owning business logic.
- A mutation may require an explicit domain capability rather than direct SQL.

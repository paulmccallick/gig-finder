# FRR-005: Managed Documents

## 📋 Status

`Implemented`

## 🎯 Context & Problem

- **User Story**: As a candidate, I want reliable, versioned documents attached to the right search context so that the assistant and I use the intended material without losing history.
- **Current State**: Managed Markdown or text documents can belong to gigs, people, or the Candidate Profile; supported source uploads are converted locally and staged for an agent turn.
- **Why Now**: Resumes, profiles, research, and application material are essential context and must remain private, attributable, and recoverable.

## 🛠️ Functional Specifications

- **Trigger**: A supported client creates, updates, reads, versions, or downloads a managed document, or the user attaches a source to the next agent message.
- **Input Data**: Friendly name, document type, owner, optional description, Markdown or text content, and optional exact version.
- **Happy Path**:
  1. The user or assistant finds a document by friendly context and reads the authoritative current or requested historical version.
  2. View and Download return that exact version, while updates create durable history rather than overwriting it invisibly.
- **Alternative Paths**:
  - A source file is uploaded -> Convert it locally, preserve the source, and stage a reference without changing managed state.
  - A filesystem projection drifts or fails -> Continue to treat database state as authoritative and make projection repairable.

## 🛡️ Acceptance Criteria & Guardrails

- **Scenarios**:
  - **Given** multiple document versions, **When** an exact version is requested, **Then** viewing, downloading, and agent context use the same content.
  - **Given** a Profile context document, **When** the agent considers context, **Then** its name and description are visible and content is read on demand.
  - **Given** a staged upload, **When** no managed-document action is requested, **Then** the source remains unaltered and no document is created implicitly.
- **Error Boundaries**: Conversion, lookup, or projection failures are explicit and do not replace the last authoritative version.
- **Data Validation**: Ownership and document type must agree; Profile documents have a name and may have a bounded description; arbitrary file reads are prohibited.

## 🛑 Out of Scope

- Editing the original uploaded DOCX or PDF in place.
- Treating filesystem projections or conversation history as authoritative document storage.

## 📈 Consequences & Impact

- **UX/UI Impact**: Documents appear through friendly names and exact-version View and Download actions rather than internal identifiers.
- **Data Model Changes**: None; SQLite owns document identity, metadata, content, links, and immutable versions.
- **Performance Targets**: Metadata discovery remains lightweight; document content is loaded only when needed.

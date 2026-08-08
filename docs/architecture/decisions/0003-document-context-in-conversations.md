# ADR 0003: Keep document content out of conversation history

**Status:** Accepted
**Date:** 2026-08-05

## Context

Document reads can add large, private content to an agent turn. Persisting that
content in every conversation message would duplicate managed documents, grow
history quickly, and leave stale copies after a document changes. The model
still needs prior document context and may need an exact historical version.

## Decision

Persist a successful managed `get_document` result in conversation history as
compact presentation metadata: its document reference, resolved version,
current version, display name, document type, and media type. Document content
is not persisted. When building model context, core finds the latest reference
to each document within the selected history and reads that exact version from
the document service. Earlier references to the same document remain compact,
so the model receives one content-bearing representation per document while
clients can restore friendly document actions.

The hydrated result identifies both the selected version and current version.
If they differ, the agent chooses whether the request requires historical
fidelity or a fresh `get_document` call for the current version. Explicit
version comparisons remain available through separate tool calls.

This policy is implemented by the conversation service in
`src/core/conversation-service.ts`; document retrieval remains behind the core
`ConversationDocumentAccess` port.

## Consequences

- Conversation storage does not duplicate managed document contents.
- Restored clients can present document actions from durable friendly metadata.
- Replaying a conversation resolves document content from its authoritative
  versioned source.
- Context size includes at most one hydrated result per referenced document.
- Referenced versions must remain readable for durable conversations.
- Context construction performs document reads before invoking the model.

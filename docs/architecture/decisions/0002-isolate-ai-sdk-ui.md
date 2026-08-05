# ADR 0002: Isolate AI SDK UI in the web package

**Status:** Accepted
**Date:** 2026-08-05

## Context

AI SDK UI provides browser and UI-stream representations such as `UIMessage`,
`UIMessageChunk`, `useChat`, and `DefaultChatTransport`. Using those types as
core or persistence contracts couples GigFinder's conversation model to a web
framework and allows SDK changes to propagate across package boundaries.

AI SDK Core serves a different purpose: the agent package uses it to invoke
models, define tools, and run generation loops.

## Decision

AI SDK UI imports and native types belong only in `src/web`. The web package
adapts between AI SDK UI messages/streams and GigFinder-owned conversation
contracts. It must not export AI SDK UI native types to another package.

`src/core` owns framework-neutral conversation, message, part, and turn
contracts. `src/data` persists those application types. `src/agent` implements
core runtime ports and may use AI SDK Core, but it does not expose or depend on
AI SDK UI representations.

## Consequences

- AI SDK UI upgrades are contained within the web adapter.
- Core conversation history and future memory remain usable by non-web clients.
- Explicit mapping is required between UI, core, persistence, and model
  representations.
- SDK-specific metadata must be mapped to an application-owned field or remain
  in web; it cannot leak through an SDK-native type.
- Architecture checks should prevent AI SDK UI imports from entering
  `src/core`, `src/data`, or `src/agent`.

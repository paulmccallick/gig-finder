# ADR 0001: Separate agent and client update contracts

**Status:** Accepted  
**Date:** 2026-07-27

## Context

CLI and web clients naturally express partial entity updates: omitted fields
remain unchanged and `null` clears nullable fields. OpenAI strict tool schemas
require declared object properties to be present, making that contract a poor
model-facing interface.

## Decision

Agent update tools accept `{ id, changes: [{ operation, field, value }] }`.
Their field and value descriptions enumerate accepted values derived from
domain constants. The schema constrains the operation structure; core update
schemas validate field-value compatibility and complete-entity consistency.
The agent adapter translates operations into `GigUpdate`,
`NetworkingContactUpdate`, or `MeetingUpdate` before calling the domain service.

The domain will retain partial update schemas which are more natural for other clients like the cli and web.

## Consequences

- Agent tools remain structurally strict without forcing agent-specific shapes
  into the domain.
- CLI and web clients retain conventional partial updates.
- Invalid model values produce a validation failure before persistence.
- Descriptions and tests must remain synchronized with domain enum constants.

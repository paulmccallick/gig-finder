# ADR 0001: Use operation-list patches for agent updates

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
The agent adapter translates operations into the entity-owned input contract
from ADR 0004 before calling the domain service. CLI and web may retain more
natural partial-object transport envelopes over that same domain contract.

## Consequences

- Agent tools remain structurally strict without forcing agent-specific shapes
  into the domain.
- CLI and web clients may retain conventional partial-object transports.
- Invalid model values produce a validation failure before persistence.
- Descriptions and tests must remain synchronized with domain enum constants.

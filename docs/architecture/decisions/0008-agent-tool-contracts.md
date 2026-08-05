# ADR 0008: Adapt domain capabilities to strict agent tools

**Status:** Accepted
**Date:** 2026-08-05

## Context

Agent tools expose application capabilities to a model provider whose strict
JSON Schema rules differ from natural client and domain contracts. Handwritten
tool-specific domain rules or permanent inventories would duplicate runtime
code and drift as capabilities change.

## Decision

Agent tools are adapters over narrow, client-neutral core capabilities. They do
not own domain validation, defaults, lifecycle behavior, or enum definitions.

Updates use the operation-list patch envelope from ADR 0001. Tool adapters
translate patches to the entity-owned input contract from ADR 0004 before
calling core services.

Every model-facing tool schema is strict: all reachable objects reject unknown
properties and require every declared property. Optional model inputs are
represented in a provider-compatible form, such as required nullable fields,
without changing domain optionality. Unsupported schema annotations may be
removed at the model boundary; core validation remains authoritative.

Tests validate emitted schemas recursively and verify parity between the
registered runtime tools and the expected capability sets. Contract failures
identify the tool, schema path, and violated rule without logging schemas,
prompts, or private content. These checks remain test/build concerns rather
than production runtime validation.

Tool names, descriptions, and JSON Schemas are generated from the runtime
registry when documentation or build artifacts require an inventory. A
hand-maintained tool catalog is not authoritative.

## Consequences

- Model contracts remain strict without creating agent-owned domain contracts.
- Patch and field semantics stay aligned with core schemas.
- Tool inventory can be inspected or generated from the running application.
- CI catches provider-incompatible schemas and registry drift before release.

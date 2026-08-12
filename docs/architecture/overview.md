# Architecture overview

GigFinder is a Bun and TypeScript application with a framework-neutral core and
client adapters for the web dashboard, agent, and CLI.

```mermaid
flowchart LR
  Browser[React dashboard] <-->|HTTP and UI message stream| Web[Web adapter]
  CLI[CLI adapter] --> Core
  Web --> Core
  Web --> Uploads[Upload conversion and staging]
  Core --> Agent[Agent runtime]
  Core --> Data
  Agent <-->|AI SDK Core| Model[Codex provider]
  Agent -->|Validated tool calls| Core
  Data --> SQLite[(SQLite)]
  Data --> Files[versioned files and context files]
```

## Package boundaries

- `src/core/` owns domain models, client-neutral contracts, validation, ports,
  conversation orchestration, framework-neutral sanitization of assistant text
  and reasoning, and application services. User-authored identifiers and
  structured tool and attachment data remain available for follow-up operations
  while web presentation omits system-added capabilities. Core has no dependency
  on client or persistence packages.
- `src/data/` implements core persistence ports, SQLite transactions, auditing,
  private context resolution, managed filesystem projections, and guarded
  legacy migrations. Interaction rollout migrates Meetings and historical
  Person contact state while leaving legacy Business Events and Event Sources
  intact for separately approved follow-up work.
- `src/agent/` adapts core capabilities to model-facing tools and AI SDK Core.
  Agent policy is separate from the configured candidate profile.
- `src/web/` owns HTTP, AI SDK UI adaptation, uploads and conversion, static
  assets, and the React dashboard. Browser code does not construct data
  adapters.
- `src/cli/` translates commands and flags into the same core contracts used by
  other clients.
- `src/operations/` contains operator-facing database and deployment programs.
- `src/scout/` is the persistence-neutral official-source scanner. Platform
  implementations share one adapter interface and are selected by a small
  registry; each implementation owns request construction, response decoding,
  reported totals, pagination, record extraction, and platform evidence.
  Shared normalization and reconciliation remain outside platform classes.
- `src/web/app.ts` and `src/cli/app.ts` are composition roots; only composition
  roots construct concrete data adapters.

## Architecture decisions

- [ADR 0001: Use operation-list patches for agent updates](decisions/0001-agent-update-contracts.md) defines the agent's strict patch envelope over client-neutral updates.
- [ADR 0002: Isolate AI SDK UI in the web package](decisions/0002-isolate-ai-sdk-ui.md) keeps framework UI types outside core, data, and agent contracts.
- [ADR 0003: Keep document content out of conversation history](decisions/0003-document-context-in-conversations.md) stores document references and hydrates exact versions when building model context.
- [ADR 0004: Share one domain input contract across create and update](decisions/0004-share-domain-input-contracts.md) makes entity-owned input schemas the source for all client adapters.
- [ADR 0005: Store mutations as revisioned, audited transactions](decisions/0005-revisioned-audited-change-transactions.md) defines atomic revision history, audit envelopes, and safe reversion.
- [ADR 0006: Make database document state authoritative](decisions/0006-authoritative-document-state.md) treats filesystem content as imports or repairable projections.
- [ADR 0007: Deploy Docker images with external state and verified rollback](decisions/0007-immutable-production-deployment.md) defines the production release and recovery model.
- [ADR 0008: Adapt domain capabilities to strict agent tools](decisions/0008-agent-tool-contracts.md) defines tool patches, schema strictness, and generated contract documentation.
- [ADR 0009: Keep personal data out of source control](decisions/0009-keep-personal-data-out-of-source-control.md) prohibits private job-search records in tracked files and requires synthetic fixtures.
- [ADR 0010: Use BunQueue for durable background work](decisions/0010-use-bunqueue-for-background-work.md) runs long-lived Gig Scout scans outside request and browser lifetimes while keeping GigFinder state authoritative.
- [ADR 0011: Use uniform source adapters for Scout](decisions/0011-use-uniform-source-adapters-for-scout.md) gives every source acquisition method one adapter lifecycle with consistent reconciliation, pagination evidence, and private configuration boundaries.

Runtime settings are documented in [Configuration](configuration.md). Production
layout and procedures are documented in the [Deployment runbook](deployment-runbook.md).

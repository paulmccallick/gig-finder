# ADR 0004: Share one domain input contract across create and update

**Status:** Accepted  
**Date:** 2026-08-05

## Context

GigFinder has accumulated different creation and update patterns across Gigs,
People, relationships, Tasks, Interactions, and documents. Issue #62 exposed the
choice by adding creation-only schemas while update schemas remained separate.
That resembles conventional create/update DTOs, but duplicates field names,
enums, nullability, descriptions, and validation, allowing contracts to drift.
Creation and update need different service behavior, not independently authored
domain field definitions. Complete records are also unsuitable inputs because
they contain application-owned identity, metadata, and derived state. ADR 0001
still permits different agent, CLI, and web transport envelopes; this decision
governs the shared domain contract beneath them.

## Decision

Each mutable entity has two core runtime schemas:

- `<entity>EntitySchema` describes complete valid domain state.
- `<entity>InputSchema` describes fields accepted by both create and update.

Their inferred types are `<Entity>` and `<Entity>Input`. Create and update import
the same input schema object and type; structurally similar duplicate schemas do
not satisfy this decision.

The input schema is a strict projection of the entity schema. It excludes IDs,
revision metadata, timestamps, deletion state, derived values, and other
application-owned fields. Unknown properties are rejected.

Both schemas live with their domain in `src/core`, for example:

- Gig in `src/core/gigs.ts`;
- Person in `src/core/people.ts`;
- Task in `src/core/tasks.ts`; and
- Interaction in `src/core/interactions.ts`.

Relationships with substantial behavior receive their own domain module.
Centralized `create-contracts.ts` and `update-contracts.ts` files are not used;
clients import the owning domain module directly.

## Create and update behavior

Creation applies the input to domain defaults, adds application-owned identity
and metadata, and validates the resulting entity. It fails when required state
remains missing or inconsistent.

Update applies the same input to current state, preserves omitted values, and
validates the resulting entity before an audited revision is persisted.

Input semantics are consistent:

- omission preserves existing/default state;
- a value sets the field;
- `null` clears only a nullable field;
- nested objects deep-merge; and
- arrays replace as a whole.

Generated IDs, audit context, and expected revisions are trusted service
arguments, never input fields.

## Client adapters

Client transports may differ while adapting to the same core input:

```text
Agent operation list -------+
CLI JSON patch -------------+--> domain input --> create/update service
Web request ----------------+
```

Following ADR 0001, the agent may retain strict operation lists and a stricter
model-facing creation projection. Such projections must reuse or derive from
the entity-owned field schemas; they cannot redeclare domain enums, validation,
nullability, or descriptions.

Distinct commands remain appropriate for named lifecycle transitions,
concurrency boundaries, or side effects that ordinary entity input cannot
represent, such as reverting a change or replacing versioned document content.
They cannot provide a second general-purpose patch path.

## Example

```ts
const gigEntitySchema = z.object({
  id: gigIdSchema,
  company: nonEmptyText,
  title: nonEmptyText,
  stage: z.enum(pipelineStages),
  revision: positiveRevision,
  createdAt: instant,
  updatedAt: instant,
});

const gigInputSchema = strictDeepPartial(gigEntitySchema.omit({
  id: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
}));

type Gig = z.infer<typeof gigEntitySchema>;
type GigInput = z.infer<typeof gigInputSchema>;

createGig(context, generatedId, input: GigInput);
updateGig(context, existingId, input: GigInput);
```

Where schema projection would lose refinements, explicit composition may reuse
the same exported field-schema objects rather than redeclaring their rules.

## Consequences

- Domain fields and validation have one source of truth.
- Create and update differ in service behavior without drifting in accepted
  fields or values.
- Agent, CLI, and web remain adapters rather than domain owners.
- Existing entity contracts require incremental refactoring and regression
  coverage.
- Required-on-create errors are complete-entity validation errors rather than
  failures from a separately authored creation DTO.
- Nested partial and clearing behavior must remain consistent across entities.

## Alternatives rejected

- **Separate create/update DTOs:** duplicate domain definitions and drift.
- **Complete entities as input:** expose application-owned state and make
  partial updates ambiguous.
- **Untyped generic patches:** lose field validation and domain invariants.

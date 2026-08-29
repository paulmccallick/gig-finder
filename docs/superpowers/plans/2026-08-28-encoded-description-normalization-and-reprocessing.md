# Encoded Description Normalization and Position Reprocessing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode template-declared entity-encoded descriptions into canonical Markdown and generalize position backfill so explicit positions rerun from reconciliation through screening while preserving immutable history and updating linked Gig documents.

**Architecture:** JSON description format and encoding are source/template contracts consumed by the canonical converter, with defaults that preserve today's literal-tag detection and no-decoding behavior. Generic backfill creates a durable `position_backfill` run for explicit position IDs, binds the latest authoritative observation and current configuration, and creates new stage identities without mutating completed history. Core position processing coordinates managed-document updates for linked Gigs; SQLite remains the durable processing authority and BunQueue continues transporting processing IDs only.

**Tech Stack:** Bun, TypeScript, Zod, Turndown, `html-entities`, SQLite/Drizzle, BunQueue, React HTTP adapters, Playwright

**Spec:** `docs/superpowers/specs/2026-08-28-encoded-description-normalization-and-reprocessing-design.md`

## Global Constraints

- Store only decoded, normalized Markdown in Scout description artifact files; never store raw or entity-encoded provider descriptions.
- Retain only bounded acquisition provenance and hashes for raw/extracted source values.
- Resolve omitted JSON description semantics as `contentFormat: "auto"` and `contentEncoding: "none"`.
- Decode entities only when configuration declares `contentFormat: "html"` and `contentEncoding: "html-entities"`.
- Bound decoding to two passes and stop when a pass makes no change.
- Preserve completed processing, descriptions, evaluations, decisions, and managed-document versions as immutable history.
- Backfill accepts exact position IDs and an operator reason; it never selects positions implicitly during execution.
- Every selected position reruns reconciliation, authoritative description acquisition, relevance, and eligible scoring.
- Linked Gigs do not terminate backfill processing; update their existing job-description document through core services.
- Queue payloads remain `{ processingId }`.
- Do not add deferred-specific behavior.
- Do not modify or commit private production configuration or description content.
- Update product and architecture/configuration documentation; do not add an ADR.
- Run `bun run check`, `bun run build`, and `bun run test:e2e` before completion.

---

## File Structure

- `src/core/scout/sourcing/descriptions.ts` — explicit JSON format handling, configured bounded entity decoding, and converter-v2 normalization.
- `src/core/scout/sourcing/contracts.ts` — defaulted inline source format/encoding contract.
- `src/core/scout/sourcing/adapters/templates/definitions.ts` — defaulted reusable template format/encoding contract.
- `src/core/scout/sourcing/adapters/templates/support.ts` and `extractors/json.ts` — pass resolved semantics into listing normalization.
- `src/core/scout/sourcing/detail-descriptions.ts` — pass resolved semantics into detail normalization and provenance.
- `config/scout/templates/greenhouse.v3.json` — immutable Greenhouse template declaring entity-encoded description fields.
- `src/operations/scout-template-catalog.ts` — register Greenhouse v3 without removing v1/v2.
- `src/core/scout/engine/positions.ts` — generic preview/start/status and promoted-description work contracts.
- `src/core/scout/engine/scout-position-service.ts` — validate explicit backfill commands and coordinate linked Gig document projection.
- `src/core/scout/engine/screening.ts` — core processing calls the persistence preparation/completion boundary and managed-document projection coordinator.
- `src/data/migrations/0035_position_backfill.sql` and migration metadata — durable generic backfill runs/items and required constraints.
- `src/data/schema.ts` — map new backfill execution/item storage.
- `src/core/documents.ts` and `src/data/document-store.ts` — bounded immutable source provenance on each managed-document version.
- `src/data/scout-run-store.ts` — exact-ID selection, immutable processing identities, forced refetch, linked-Gig continuation, projections, and status.
- `src/data/local-application.ts` — inject existing managed-document service into core processing composition.
- `src/web/request-handler.ts` — preview/start/status HTTP contracts on the existing backfill path.
- `scripts/scout-encoded-description-selection.ts` — read-only, metadata-only affected-ID report for the production follow-up.
- `docs/product/006-gig-scout.md` and `docs/architecture/configuration.md` — configured encoding and generic backfill behavior.

---

### Task 1: Explicit Description Semantics and Greenhouse v3

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/core/scout/sourcing/descriptions.ts`
- Modify: `src/core/scout/sourcing/contracts.ts`
- Modify: `src/core/scout/sourcing/adapters/templates/definitions.ts`
- Modify: `src/core/scout/sourcing/adapters/templates/support.ts`
- Modify: `src/core/scout/sourcing/extractors/json.ts`
- Modify: `src/core/scout/sourcing/detail-descriptions.ts`
- Create: `config/scout/templates/greenhouse.v3.json`
- Modify: `src/operations/scout-template-catalog.ts`
- Test: `src/core/scout/engine/test/description-conversion.test.ts`
- Test: `src/core/scout/engine/test/json-templates.test.ts`
- Test: `src/core/scout/engine/test/detail-descriptions.test.ts`

**Interfaces:**
- Produces: `DescriptionContentFormat = "auto" | "html" | "plain-text"`
- Produces: `DescriptionContentEncoding = "none" | "html-entities"`
- Produces: `normalizeExtractedDescription(value, { contentFormat, contentEncoding }): string | null`
- Preserves: `descriptionToMarkdown(value, mediaType)` for direct HTTP response bodies whose media type is authoritative.
- Produces: `DetailDescriptionPlan.contentFormat` and `DetailDescriptionPlan.contentEncoding`
- Consumes: existing Turndown conversion, source/template parsing, listing and detail extraction.

- [ ] **Step 1: Add the direct entity-decoding dependency**

Run:

```bash
bun add html-entities
```

Expected: `package.json` and `bun.lock` record a direct runtime dependency; no transitive-only import is used.

- [ ] **Step 2: Write failing converter tests**

Add literal expectations:

```ts
test("configured entity-encoded HTML matches literal HTML", () => {
  const literal = "<h2>Scope &amp; impact</h2><ul><li>Lead teams.</li></ul>";
  const encoded = "&lt;h2&gt;Scope &amp;amp; impact&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Lead teams.&lt;/li&gt;&lt;/ul&gt;";
  expect(normalizeExtractedDescription(encoded, {
    contentFormat: "html",
    contentEncoding: "html-entities",
  })).toBe(normalizeExtractedDescription(literal, {
    contentFormat: "html",
    contentEncoding: "none",
  }));
});

test("configured decoding stops after two passes", () => {
  expect(normalizeExtractedDescription(
    "&amp;lt;p&amp;gt;Lead systems.&amp;lt;/p&amp;gt;",
    { contentFormat: "html", contentEncoding: "html-entities" },
  )).toBe("Lead systems.");
});

test("plain literal entity examples are unchanged", () => {
  expect(normalizeExtractedDescription(
    "Use &lt;div&gt; as a literal example.",
    { contentFormat: "plain-text", contentEncoding: "none" },
  )).toBe("Use &lt;div&gt; as a literal example.");
});

test("literal JSON HTML is converted only when declared HTML", () => {
  expect(normalizeExtractedDescription("<p>Lead teams.</p>", {
    contentFormat: "html",
    contentEncoding: "none",
  })).toBe("Lead teams.");
  expect(normalizeExtractedDescription("<p>Literal example.</p>", {
    contentFormat: "plain-text",
    contentEncoding: "none",
  })).toBe("<p>Literal example.</p>");
});

test("omitted JSON semantics preserve current auto detection", () => {
  expect(normalizeExtractedDescription("Plain text.", {})).toBe("Plain text.");
  expect(normalizeExtractedDescription("<p>HTML text.</p>", {})).toBe("HTML text.");
});
```

- [ ] **Step 3: Run the converter tests and verify RED**

Run:

```bash
bun test src/core/scout/engine/test/description-conversion.test.ts
```

Expected: FAIL because the JSON normalizer does not accept explicit format/encoding semantics and still exports `html-to-markdown-v1`.

- [ ] **Step 4: Implement bounded configured decoding**

Use the direct decoder before Turndown and change the immutable converter identity:

```ts
import { decode } from "html-entities";

export type DescriptionContentFormat = "auto" | "html" | "plain-text";
export type DescriptionContentEncoding = "none" | "html-entities";
export const scoutDescriptionConverterVersion = "html-to-markdown-v2";

function decodeConfiguredHtml(value: string, encoding: DescriptionContentEncoding) {
  if (encoding !== "html-entities") return value;
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decode(decoded, { level: "html5", scope: "body" });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
```

Add `normalizeExtractedDescription` as the only configured JSON-field normalization entry point. Resolve omitted options to `{ contentFormat: "auto", contentEncoding: "none" }`. Decode before conversion, call Turndown for `html`, preserve `plain-text` exactly, and retain the current literal-tag detection for `auto`, all subject to the normalized 200,000-character limit. Reject `html-entities` with either `auto` or `plain-text`. Keep `descriptionToMarkdown(value, mediaType)` for direct HTTP bodies, using their authoritative media type rather than JSON configuration.

- [ ] **Step 5: Add encoding to inline and reusable description contracts**

Add defaulted format and encoding fields to reusable `fields.description`, reusable `detailDescription`, custom JSON description configuration, and inline JSON detail configuration:

```ts
contentFormat: z.enum(["auto", "html", "plain-text"]).default("auto"),
contentEncoding: z.enum(["none", "html-entities"]).default("none"),
```

Add schema refinement rejecting `html-entities` unless `contentFormat === "html"`. Leave existing immutable template artifacts unchanged; their resolved definitions receive the defaults. Regression fixtures must prove omitted settings resolve to `auto`/`none`.

Thread the parsed value through listing normalization and `DetailDescriptionPlan`; do not inspect text to infer entity encoding.

- [ ] **Step 6: Write failing template/detail tests**

Add tests proving:

```ts
expect(catalog.resolve({ id: "greenhouse", version: 3 })
  .fields.description?.contentEncoding).toBe("html-entities");
expect(catalog.resolve({ id: "greenhouse", version: 3 })
  .fields.description?.contentFormat).toBe("html");

expect(result.markdown).toContain("- Lead teams.");
expect(result.markdown).not.toContain("&lt;li");
expect(result.extractedContentHash).toBe(expectedRawExtractedHash);
expect(result.converterVersion).toBe("html-to-markdown-v2");
```

Cover default-auto JSON plain text, default-auto JSON literal HTML, explicit plain text, explicit literal HTML, listing-provided and detail-fetched Greenhouse descriptions, links, attributes, single encoding, double encoding, direct HTML responses, and invalid `auto`/`plain-text` plus `html-entities`. Assert Greenhouse v1 and v2 files remain unchanged and resolve to the defaults.

- [ ] **Step 7: Verify RED for template propagation**

Run:

```bash
bun test src/core/scout/engine/test/json-templates.test.ts src/core/scout/engine/test/detail-descriptions.test.ts
```

Expected: FAIL because no template or plan exposes `contentEncoding`.

- [ ] **Step 8: Add and register immutable Greenhouse v3**

Copy the readable v2 artifact to `greenhouse.v3.json`, set `version` to `3`, and add:

```json
"contentEncoding": "html-entities"
```

to both `fields.description` and `detailDescription`. Register v3 beside v1/v2 in `scout-template-catalog.ts`.

The complete v3 declarations are:

```json
"contentFormat": "html",
"contentEncoding": "html-entities"
```

- [ ] **Step 9: Pass encoding through every conversion boundary**

Update generic JSON extraction, reusable template support, and detail acquisition to call:

```ts
normalizeExtractedDescription(extracted, {
  contentFormat: plan.contentFormat,
  contentEncoding: plan.contentEncoding,
});
```

Keep `sourceContentHash` over the exact response body and `extractedContentHash` over the exact extracted encoded string. Store neither raw value.

- [ ] **Step 10: Run focused tests and commit**

Run:

```bash
bun test src/core/scout/engine/test/description-conversion.test.ts src/core/scout/engine/test/json-templates.test.ts src/core/scout/engine/test/detail-descriptions.test.ts src/core/scout/engine/test/scan-company.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add package.json bun.lock src/core/scout/sourcing config/scout/templates/greenhouse.v3.json src/operations/scout-template-catalog.ts src/core/scout/engine/test
git commit -m "fix: decode configured Scout descriptions"
```

---

### Task 2: Durable Explicit-ID Backfill Contracts and Storage

**Files:**
- Modify: `src/core/scout/engine/positions.ts`
- Create: `src/data/migrations/0035_position_backfill.sql`
- Modify: `src/data/migrations/meta/_journal.json`
- Create: `src/data/migrations/meta/0035_snapshot.json`
- Modify: `src/data/schema.ts`
- Modify: `src/data/scout-run-store.ts`
- Test: `src/data/test/scout-migration.test.ts`
- Test: `src/data/test/scout-run-store.test.ts`

**Interfaces:**
- Produces: `ScoutPositionBackfillCommand`
- Produces: `ScoutPositionBackfillPreview`
- Produces: `ScoutPositionBackfillStatus`
- Produces: `ScoutPositionStore.previewBackfill`, `startBackfill`, and `backfillStatus`
- Consumes: exact position IDs, current position/observation/configuration storage, current screening snapshot.

- [ ] **Step 1: Define exact public contracts in a failing store test**

Use these contracts:

```ts
export interface ScoutPositionBackfillCommand {
  positionIds: string[];
  reason: string;
}

export interface ScoutPositionBackfillPreview {
  requested: number;
  accepted: Array<{
    positionId: string;
    company: string;
    title: string;
    state: ScoutPositionState;
    linkedGigId: string | null;
  }>;
  rejected: Array<{ positionId: string; code: "not_found" | "no_observation" | "no_active_configuration" }>;
}

export interface ScoutPositionBackfillStatus {
  runId: string;
  reason: string;
  selection: { requested: number; accepted: number; rejected: number };
  stages: Record<ScoutPositionProcessingStage, ScoutBackfillStageStatus>;
  positionOutcomes: Record<string, number>;
  gigDocuments: { pending: number; updated: number; unchanged: number; failed: number };
}
```

Test duplicate IDs, malformed IDs, more than 1,000 IDs, missing positions, positions without observations, and positions whose current company configuration has no matching active source.

- [ ] **Step 2: Run the focused store test and verify RED**

Run:

```bash
bun test src/data/test/scout-run-store.test.ts --test-name-pattern "explicit position backfill"
```

Expected: FAIL because preview/start/status do not exist.

- [ ] **Step 3: Add migration 0035**

Rebuild the `scout_runs.run_type` check to include `position_backfill` while preserving every existing column, index, and row. Add:

```sql
CREATE TABLE scout_position_backfill_items (
  run_id text NOT NULL REFERENCES scout_runs(id),
  position_id text NOT NULL REFERENCES scout_positions(id),
  observation_id text NOT NULL REFERENCES scout_position_observations(id),
  configuration_source_id text NOT NULL REFERENCES scout_company_configuration_sources(id),
  linked_gig_id text REFERENCES gigs(id),
  requested_at text NOT NULL,
  PRIMARY KEY (run_id, position_id)
);
CREATE INDEX scout_position_backfill_items_position_idx
  ON scout_position_backfill_items(position_id, run_id);
```

Add nullable `operator_reason` and `request_fingerprint` columns to `scout_runs`; existing rows receive `NULL`. A `position_backfill` row requires a 1–500 character reason and a 64-character lowercase hexadecimal fingerprint through checks/triggers enforced by migration tests. Add a partial unique index on `request_fingerprint` where `run_type = 'position_backfill'` so an HTTP retry resolves the existing execution instead of creating another run.

Add nullable bounded source-provenance columns to `managed_document_versions`:

```sql
source_description text,
source_provenance_json text
```

Existing versions remain valid with `NULL`. New Scout-created job-description versions require both fields through the managed-document service contract; no raw description content is stored in either field.

- [ ] **Step 4: Write migration RED coverage**

Create a pre-0035 database with full, legacy-backfill, observations, completed processing, and outbox rows. Assert after migration:

```ts
expect(runTypes).toEqual(["full", "legacy_backfill"]);
expect(processingRows).toEqual(beforeProcessingRows);
expect(outboxRows).toEqual(beforeOutboxRows);
expect(columns).toContain("operator_reason");
expect(columns).toContain("request_fingerprint");
expect(tables).toContain("scout_position_backfill_items");
```

Also prove an empty reason, a `position_backfill` without a reason/fingerprint, and a duplicate position-backfill fingerprint are rejected. Prove pre-0035 managed-document versions migrate unchanged with nullable provenance.

- [ ] **Step 5: Run migration tests and verify RED**

Run:

```bash
bun test src/data/test/scout-migration.test.ts
```

Expected: FAIL before migration 0035 is registered.

- [ ] **Step 6: Implement preview and atomic start**

`previewBackfill` resolves each exact ID against the latest observation and the company’s current active configuration source with the position’s `source_key`. It returns metadata only.

`startBackfill` must:

1. Re-run preview inside one SQLite transaction.
2. Reject the whole command if any requested ID is rejected.
3. Snapshot the current profile/model/cache material into a new `position_backfill` Scout run.
4. Insert immutable backfill items with exact observation/configuration bindings.
5. Create a new `reconcile_gig` processing identity containing `runId` so a completed prior run cannot satisfy it.
6. Insert durable outbox rows in the same transaction.

Use SHA-256 over canonical JSON containing sorted unique IDs, trimmed reason, exact selected observation IDs, and exact selected configuration-source IDs. Store it in `scout_runs.request_fingerprint`. If the unique insert conflicts, load and return that existing run after verifying its immutable item set matches. Do not make stage identities deterministic across different backfill runs.

- [ ] **Step 7: Implement status aggregation**

Aggregate only processing rows bound to the execution run. Report stage counts and linked-Gig document projection counts without titles, descriptions, source responses, profile content, or prompts.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
bun test src/data/test/scout-migration.test.ts src/data/test/scout-run-store.test.ts
bun run db:check
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/core/scout/engine/positions.ts src/data/migrations src/data/schema.ts src/data/scout-run-store.ts src/data/test
git commit -m "feat: add durable explicit position backfill"
```

---

### Task 3: Full-Pipeline Reprocessing and Immutable Projection Rules

**Files:**
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/core/scout/engine/screening.ts`
- Test: `src/data/test/scout-run-store.test.ts`
- Test: `src/core/scout/engine/test/screening.test.ts`
- Test: `src/operations/test/scout-runtime.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 backfill run/items and Task 1 converter identity.
- Produces: a new stage chain for every selected position, forced refetch, and latest-success projections.
- Preserves: existing runtime payload `{ processingId }` and BunQueue retry/recovery behavior.

- [ ] **Step 1: Write failing full-pipeline persistence tests**

Create positions with completed historical stages, including one linked Gig. Start a backfill and assert the desired sequence:

```ts
expect(store.stage(firstJob.processingId)).toBe("reconcile_gig");
store.reconcileGig(firstJob.processingId, now);
expect(nextStage(positionId)).toBe("acquire_description");
expect(store.descriptionInput(nextProcessingId).existingDescriptionId).toBeNull();
```

Prove prior processing remains `completed`, the new run has distinct identities, and a linked Gig still receives `acquire_description` work.

- [ ] **Step 2: Verify RED**

Run:

```bash
bun test src/data/test/scout-run-store.test.ts --test-name-pattern "position backfill reruns the complete pipeline"
```

Expected: FAIL because linked-Gig reconciliation terminates and description input reuses the prior description.

- [ ] **Step 3: Make stage identity run-bound for position backfills**

For `position_backfill` only, include `runId` in reconciliation, description, relevance, and candidate-match input identities. Preserve ordinary full-run and legacy-backfill identity behavior.

Do not change completed historical rows. Supersede only nonterminal rows that compete for the same position/stage projection.

- [ ] **Step 4: Continue linked positions after reconciliation**

When the processing run is `position_backfill`, reconciliation records the exact linked Gig in the backfill item and always schedules `acquire_description`. Ordinary reconciliation keeps its existing early-termination behavior.

- [ ] **Step 5: Force authoritative refetch**

For a `position_backfill` row, `descriptionInput` returns `existingDescriptionId: null` and resolves the detail plan from its immutable current-configuration binding. It must never reuse an observation artifact as the acquisition result.

- [ ] **Step 6: Preserve current projections until success**

Persist the new description/evaluation history first. Update current state revision and current decision only when the new stage completes successfully. A failed stage records failure on the new processing row and leaves the prior successful description/evaluation visible.

For agent-irrelevant positions:

```ts
expect(stillIrrelevant.currentDecision.origin).toBe("agent");
expect(becomesRelevant.state).toBe("needs_user_review");
```

For linked positions, execute relevance/scoring history without changing `promoted` state.

- [ ] **Step 7: Add runtime restart/idempotency coverage**

Verify an interrupted backfill rehydrates its missing queue job from the outbox, retrying the same run does not create a second stage row, and a second separately requested backfill creates a new immutable chain.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
bun test src/core/scout/engine/test/screening.test.ts src/data/test/scout-run-store.test.ts src/operations/test/scout-runtime.integration.test.ts
bun run typecheck
bun run architecture
```

Expected: PASS.

Commit:

```bash
git add src/core/scout/engine/screening.ts src/data/scout-run-store.ts src/core/scout/engine/test src/data/test src/operations/test
git commit -m "feat: rerun complete position processing"
```

---

### Task 4: Linked Gig Managed-Document Update Saga

**Files:**
- Modify: `src/core/scout/engine/positions.ts`
- Modify: `src/core/scout/engine/scout-position-service.ts`
- Modify: `src/core/scout/engine/screening.ts`
- Modify: `src/core/documents.ts`
- Modify: `src/core/managed-document-service.ts`
- Modify: `src/core/ports.ts`
- Modify: `src/data/document-store.ts`
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/data/local-application.ts`
- Test: `src/core/scout/engine/test/screening.test.ts`
- Test: `src/data/test/scout-run-store.test.ts`
- Test: `src/core/test/services.test.ts`

**Interfaces:**
- Produces: `ScoutPromotedDescriptionWork`
- Produces: persistence preparation/completion/failure operations for the linked document projection.
- Consumes: existing `ManagedDocumentService.get/update`, deterministic change IDs, exact linked Gig/document IDs.

- [ ] **Step 1: Define the promoted-description work contract in failing tests**

Use:

```ts
export interface ScoutPromotedDescriptionWork {
  processingId: string;
  positionId: string;
  gigId: string;
  managedDocumentId: string;
  expectedDocumentVersion: number;
  markdown: string;
  sourceDescription: string;
  sourceProvenance: {
    officialUrl: string;
    retrievedAt: string;
    sourceContentHash: string;
    extractedContentHash: string;
    sourceKey: string;
    configurationVersion: number;
    extractionStrategy: string;
    converterVersion: string;
  };
  documentChangeId: string;
}
```

The store prepares this only after persisting the new position description and resolving the completed promotion’s exact Gig/document link.

- [ ] **Step 2: Write failing saga tests**

Cover:

- linked Gig with corrected content creates exactly one new document version;
- identical normalized content returns `unchanged` and creates no version;
- a changed version stores the exact bounded Scout source provenance but no description body or provider response;
- document revision conflict leaves description processing retryable/failed and does not mark projection complete;
- retry resolves the current document version and produces one final version;
- no direct SQL writes target managed-document tables from `scout-run-store.ts`.

- [ ] **Step 3: Verify RED**

Run:

```bash
bun test src/core/scout/engine/test/screening.test.ts src/data/test/scout-run-store.test.ts --test-name-pattern "promoted description"
```

Expected: FAIL because description completion currently cannot project into a linked managed document.

- [ ] **Step 4: Split description completion into durable preparation and completion**

Add persistence-port operations:

```ts
prepareDescriptionCompletion(processingId, result, now): {
  descriptionId: string;
  promotedDocument: ScoutPromotedDescriptionWork | null;
};
completeDescription(processingId, descriptionId, documentOutcome, now): void;
failDescriptionProjection(processingId, code, message, now): void;
```

Preparation is idempotent and may be replayed after a process crash. It does not complete the processing stage until the managed-document side effect is verified.

- [ ] **Step 5: Add immutable managed-document version provenance**

Define an implementation-independent `ManagedDocumentSourceProvenance` schema in `src/core/documents.ts` with the exact bounded fields from `ScoutPromotedDescriptionWork.sourceProvenance`. Add nullable `sourceDescription` and `sourceProvenance` to `ManagedDocumentVersionData`, and optional paired fields to `UpdateManagedDocumentInput` with a refinement requiring both or neither.

Extend `DocumentWriteRepository.addVersion` and `SqliteDocumentWriteRepository` to persist these values in the 0035 columns. Existing callers omit them and keep current behavior. `ManagedDocumentService.update` validates and forwards them. Add repository/service tests proving immutable round-trip and rejecting only-one-field input.

- [ ] **Step 6: Coordinate the domain service in core**

Inject `Pick<ManagedDocumentService, "get" | "update">` into the core position processor/service composition. For promoted work:

```ts
const current = documents.get(work.managedDocumentId);
if (!current) throw new Error("Promoted Gig job description not found.");
documents.update({
  actor: "Gig Scout",
  source: "automation",
  summary: "Refresh promoted Gig job description",
  changeId: work.documentChangeId,
  occurredAt: now,
}, {
  documentId: work.managedDocumentId,
  expectedVersion: current.currentVersion,
  content: work.markdown,
  changeSummary: "Refresh from current official Scout posting",
  sourceDescription: work.sourceDescription,
  sourceProvenance: work.sourceProvenance,
});
```

Use the managed-document service’s unchanged-content idempotency. Verify the resulting document still has exact Gig ownership and `job_description`/`text/markdown` identity before completing persistence.

- [ ] **Step 7: Keep processing and document outcomes independently auditable**

Persist `pending`, `updated`, `unchanged`, or `failed` projection outcome for status aggregation. A document failure must not erase the new position description history, alter promoted state, or create a second document.

- [ ] **Step 8: Wire the existing service in the composition root**

Update `openLocalApplication` and web composition to pass `application.documents`. Do not construct services inside data or operations, and keep dependency-cruiser green.

- [ ] **Step 9: Run focused tests and commit**

Run:

```bash
bun test src/core/scout/engine/test/screening.test.ts src/data/test/scout-run-store.test.ts src/core/test/services.test.ts
bun run architecture
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/core/scout/engine src/core/documents.ts src/core/managed-document-service.ts src/core/ports.ts src/data/document-store.ts src/data/scout-run-store.ts src/data/local-application.ts src/core/test src/data/test
git commit -m "feat: refresh promoted Gig descriptions"
```

---

### Task 5: Existing Backfill HTTP Contract and Read-Only Selection Report

**Files:**
- Modify: `src/core/scout/engine/scout-position-service.ts`
- Modify: `src/web/request-handler.ts`
- Create: `scripts/scout-encoded-description-selection.ts`
- Modify: `package.json`
- Test: `src/web/test/request-handler.test.ts`
- Test: `scripts/scout-encoded-description-selection.test.ts`

**Interfaces:**
- Produces: `POST /api/gig-scout/positions/backfill/preview`
- Produces: `POST /api/gig-scout/positions/backfill`
- Produces: `GET /api/gig-scout/positions/backfill/:runId`
- Produces: `bun run scout:encoded-description-selection -- --database <path> --descriptions <path> --output <ignored-json>`
- Consumes: Task 2 core/store contracts; no new processing mechanism.

- [ ] **Step 1: Write failing HTTP tests**

Use the request body:

```json
{
  "positionIds": ["spos_0123456789abcdef"],
  "reason": "Reprocess entity-encoded descriptions after converter v2"
}
```

Assert preview returns `200` without creating a run, start returns `202` with a run ID, status returns stable bounded counts, duplicate IDs normalize once, malformed/empty/over-1,000 IDs return `400`, and rejected exact IDs prevent partial start.

- [ ] **Step 2: Verify HTTP RED**

Run:

```bash
bun test src/web/test/request-handler.test.ts --test-name-pattern "explicit position backfill"
```

Expected: FAIL because the existing endpoint accepts only `sourceRunId` query parameters.

- [ ] **Step 3: Add service validation and compatible routes**

Keep the existing source-run query form operational. For JSON requests, parse strict `{ positionIds, reason }`, normalize unique IDs in lexical order, limit the reason to 500 characters, and delegate preview/start/status to core.

Do not accept states, companies, SQL-like filters, converter predicates, or implicit selection in the mutating endpoint.

- [ ] **Step 4: Write failing selector tests**

Build a synthetic SQLite database and synthetic Markdown artifact root containing:

- `needs_user_review` with encoded structural tags;
- agent-irrelevant with encoded structural tags;
- promoted/linked with encoded structural tags;
- user-irrelevant with encoded structural tags;
- clean Markdown; and
- a missing artifact.

Assert the report selects only the first three, reports the missing file as unresolved, contains exact position/Gig IDs and bounded metadata, and never contains Markdown content.

- [ ] **Step 5: Implement the read-only selector**

Open SQLite with `readonly: true`. Resolve current position state/decision origin, latest description artifact, and completed promotion link. Inspect files without writing them. Match encoded structural tags using a bounded case-insensitive pattern over recognized structural names such as `div`, `p`, `ul`, `ol`, `li`, `h1`–`h6`, `a`, `strong`, and `em`.

Write only ignored metadata JSON under `tmp/` with:

```ts
interface EncodedDescriptionSelectionReport {
  generatedAt: string;
  complete: boolean;
  selected: Array<{ positionId: string; state: string; origin: string | null; linkedGigId: string | null; company: string }>;
  excluded: Record<string, number>;
  unresolved: Array<{ positionId: string; code: "missing_artifact" | "unreadable_artifact" }>;
}
```

Never emit paths, description content, source responses, profile data, notes, reasons, or evaluation prose.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
bun test src/web/test/request-handler.test.ts scripts/scout-encoded-description-selection.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/core/scout/engine/scout-position-service.ts src/web/request-handler.ts src/web/test/request-handler.test.ts scripts/scout-encoded-description-selection.ts scripts/scout-encoded-description-selection.test.ts package.json
git commit -m "feat: expose explicit position reprocessing"
```

---

### Task 6: Documentation, End-to-End Verification, and Release Evidence

**Files:**
- Modify: `docs/product/006-gig-scout.md`
- Modify: `docs/architecture/configuration.md`
- Modify: `src/web/e2e/gig-scout.e2e.ts`
- Modify: `scripts/smoke-live.ts` only if needed to invoke the existing bounded Scout live lane; do not weaken its assertions.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: documented configured encoding/backfill semantics and release evidence.

- [ ] **Step 1: Update product documentation**

Document that configured descriptions are normalized to Markdown before storage/model use, explicit position reprocessing preserves immutable history, successful reruns replace current projections, agent-irrelevant positions may return to review, and promoted positions remain promoted while their existing Gig document receives a new version.

- [ ] **Step 2: Update architecture/configuration documentation**

Document the `auto`/`none` defaults, explicit `contentFormat` and `contentEncoding`, immutable template versioning, company inheritance/override rules, Greenhouse v3, exact-ID backfill, current observation/configuration binding, minimal queue payload, and core ownership of managed-document updates.

Explicitly state that ordinary deployment does not select or start backfill and that production configuration upgrades are separate operator-authorized changes.

- [ ] **Step 3: Add a synthetic full-flow E2E test**

Run a synthetic Scout source whose configured description is entity-encoded HTML. Assert:

- stored review Markdown renders headings/lists without `&lt;` structural tags;
- explicit backfill preview/start uses the position ID;
- a new evaluation becomes current;
- an agent-irrelevant corrected result can appear in review; and
- a promoted fixture remains absent from review while its existing managed document advances exactly one version.

- [ ] **Step 4: Run all normal verification**

Run:

```bash
bun run check
bun run db:check
bun run build
bun run test:e2e
```

Expected: all commands PASS with no architecture violations, migration drift, warnings attributable to the change, or flaky retries.

- [ ] **Step 5: Run the bounded live format/encoding matrix**

Use ignored private canary configuration to run current official sources for these lanes:

1. Greenhouse v3 JSON `html` with `html-entities`;
2. a JSON source returning literal HTML with `none` encoding;
3. a JSON source exercising default/plain behavior; and
4. a direct HTML detail response using its authoritative HTTP media type when an active canary exists.

Require at least three distinct current official sites and fail when a required canary does not produce non-empty normalized Markdown. The deterministic suite covers every supported semantic combination even when no live provider supplies one. Report only company, source URL origin, template/version, resolved format/encoding, extraction strategy, converter version, outcome, failure code, and duration. Do not store or print response bodies, extracted descriptions, or Markdown.

- [ ] **Step 6: Commit documentation and verification**

```bash
git add docs/product/006-gig-scout.md docs/architecture/configuration.md src/web/e2e/gig-scout.e2e.ts scripts/smoke-live.ts
git commit -m "docs: describe position reprocessing"
```

- [ ] **Step 7: Complete the repository release workflow**

Run final Superpowers review, fix all findings, then run `release-verifier` and `change-overview` against the exact PR head. Watch `gh pr checks --watch` and do not merge or deploy if a later commit invalidates evidence.

---

### Task 7: Post-Deployment Production Backfill

**Files:**
- No tracked source changes.
- Write private reports only beneath ignored `tmp/`.

**Interfaces:**
- Consumes: the exact deployed merge revision, production-owned configuration, read-only selector, and explicit-ID backfill API.
- Produces: bounded production evidence and durable corrected results.

- [ ] **Step 1: Deploy before any recovery work**

Use the deployment agent to merge, publish the immutable merge-SHA image, back up, migrate, cut over, and verify exact revision, health, database integrity, queues, logs, and artifact mount. Confirm no backfill run started during migration or application startup.

- [ ] **Step 2: Upgrade current Greenhouse configurations explicitly**

Outside the application deployment, update every active production company configuration referencing Greenhouse v2 to Greenhouse v3 through the existing company-import workflow. Preserve the production-owned `/etc/gig-finder/config.json`; do not have the application deploy script rewrite it.

Verify the import creates immutable company-configuration versions, retains Greenhouse v2 history, changes every active Greenhouse source to v3, and changes no non-Greenhouse source.

- [ ] **Step 3: Produce and review the affected-ID report**

Run the selector against the production SQLite database and Scout description artifact root with read-only database access. Verify the selected set contains only `needs_user_review`, agent-origin `irrelevant`, and `promoted` positions; user-origin irrelevant/rejected positions are excluded; unresolved artifacts are explicit.

- [ ] **Step 4: Submit the exact approved IDs**

Call preview with the report’s exact IDs and compare requested/accepted/rejected counts. Start only when accepted IDs match the reviewed report exactly and rejected is zero. Record the returned backfill run ID.

- [ ] **Step 5: Monitor durable completion**

Poll status until no stage or Gig document projection is pending. Queue retry handles transient failures; do not manually recreate processing rows or bypass domain services.

- [ ] **Step 6: Verify bounded production outcomes**

Confirm:

- corrected artifact files contain Markdown and no encoded structural tags;
- agent-irrelevant transitions and review revisions match the report;
- promoted positions remain promoted;
- each affected promoted Gig retains one linked job-description document with the expected new version;
- unchanged content did not add duplicate versions or model work;
- unresolved failures preserved prior current projections; and
- no private description, profile, note, prompt, or response content appears in evidence.

- [ ] **Step 7: Close the issue only after recovery verification**

Keep #143 in Development through deployment and backfill. Move it to Done only after the exact production run and bounded verification are recorded.

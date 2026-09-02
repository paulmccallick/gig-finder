# Authoritative Gig Description and Apply Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make managed documents and the Gig's canonical source URL drive the Gig drawer, and let the existing promotion retry operation reapply a completed Scout position to its existing Gig.

**Architecture:** The implementation first records the product contract, then moves the Gig read path to managed documents before deleting the legacy filesystem projection. Scout backfill becomes Scout-state-only, while `ScoutPositionService` reconstructs completed promotion work and sends the current `NormalizedPosition` through the same `GigDomainService` and `ManagedDocumentService` promotion operation used by Pursue.

**Tech Stack:** Bun 1.3.14, TypeScript, React 19, SQLite, Drizzle Kit, Bun test, Playwright, dependency-cruiser.

**Spec:** `docs/superpowers/specs/2026-09-01-authoritative-gig-description-and-apply-link-design.md`

## Global Constraints

- Work in the primary checkout on `issue-149-gig-description-apply`; do not create a persistent worktree.
- Preserve and exclude the user's unrelated `AGENTS.md`, `.agents/`, `.codex/`, `.serena/`, `.superpowers/`, and `output/` changes from every task commit.
- Use synthetic fixtures only. Never copy production records, URLs, descriptions, SQLite files, or logs into tracked files.
- Update product and architecture documentation before changing the corresponding behavior.
- Do not edit architecture documentation for this issue: the existing architecture docs describe the general runtime artifact root, which remains, and contain no Gig filesystem-projection contract to remove.
- `GigDomainService` owns every Gig mutation; `ManagedDocumentService` owns every managed-document mutation.
- Scout data adapters reconstruct Scout evidence but do not query or mutate Gig- or managed-document-owned tables.
- Position backfill reacquires and reevaluates Scout state; it does not mutate a Gig or managed document.
- Keep `POST /api/gig-scout/positions/:positionId/promotion/retry` and `ScoutPursueResult` as the public recovery contract.
- Completed-position retry targets the existing linked Gig and never creates another Gig or user decision.
- Leave existing legacy filesystem contents on disk during migration and deployment.
- Retain the general runtime artifact mount and `maintenance artifacts` integrity command; they protect supported Scout/runtime artifacts and are not the removed Gig artifact subsystem.
- Use TDD for each behavior change and commit each task separately.

---

### Task 1: Establish the product contract

**Files:**
- Modify: `docs/product/001-opportunity-pipeline.md`
- Modify: `docs/product/005-managed-documents.md`
- Modify: `docs/product/006-gig-scout.md`
- Modify: `docs/product/overview.md`

**Interfaces:**
- Consumes: the approved design in `docs/superpowers/specs/2026-09-01-authoritative-gig-description-and-apply-link-design.md`.
- Produces: the authoritative product wording used by all later tasks and reviews.

- [ ] **Step 1: Update FRR-001 with the Gig read and Apply contract**

Add these rules to the happy path and acceptance scenarios:

```markdown
- A Gig's current official posting URL is `Gig.sourceUrl`; Apply opens that URL in a new browser context.
- Gig details select the current linked managed `job_description`, render its current Markdown, and link to the exact managed-document version.
- A Gig without a linked managed job description displays an explicit unavailable state.
```

Update the entity/data-model wording so Gig application material is described as linked managed documents rather than registered artifacts.

- [ ] **Step 2: Update FRR-005 with Gig document authority**

Add this scenario:

```markdown
- **Given** a Gig has a linked managed `job_description`, **When** Gig details are opened, **Then** its current managed version is the authoritative description rendered by the application.
```

Retain the existing general filesystem-projection language for Candidate Profile materialization; remove only wording that implies a Gig description can come from a filesystem projection.

- [ ] **Step 3: Update FRR-006 with completed promotion retry**

Replace the promoted-position portion of `Reprocessing Outcomes` with:

```markdown
- **Backfill and Promotion Retry**: Position backfill reacquires the official description and reevaluates current Scout state while preserving immutable history. It leaves a linked Gig and its managed documents unchanged. Once current Scout state is complete, the existing promotion retry operation can reapply a completed promoted position to the same linked Gig through the normal Gig and managed-document promotion flow.
```

Extend `Promotion Outcomes and Recovery` with:

```markdown
A completed promoted position may be retried against its existing linked Gig. Retry reconstructs the current normalized posting and description, preserves the original decision and promoted state, and returns the existing promotion outcome contract.
```

Update the acceptance scenario that currently advances a promoted Gig's document during backfill. The replacement must assert that backfill changes only Scout state and a subsequent promotion retry updates the linked Gig/document.

- [ ] **Step 4: Update the product overview**

Change the Gig entity description from “registered artifacts” to “versioned managed documents.” State that Gig details render linked managed job descriptions and Apply uses the Gig's canonical official posting URL.

- [ ] **Step 5: Verify documentation consistency**

Run:

```bash
rg -n "promoted position is reprocessed|registered artifacts|Gig.*filesystem.*description" docs/product
git diff --check
```

Expected: the obsolete promoted-backfill/document behavior and Gig artifact authority are absent; `git diff --check` prints nothing.

- [ ] **Step 6: Commit the product contract**

```bash
git add docs/product/001-opportunity-pipeline.md docs/product/005-managed-documents.md docs/product/006-gig-scout.md docs/product/overview.md
git commit -m "docs: define authoritative Gig descriptions"
```

---

### Task 2: Move the Gig drawer to managed documents

**Files:**
- Modify: `src/core/documents.ts`
- Modify: `src/core/test/services.test.ts`
- Create: `src/web/client/data/documents.ts`
- Modify: `src/web/client/data/gigs.ts`
- Modify: `src/web/client/DocumentViewer.tsx`
- Modify: `src/web/client/App.tsx`
- Modify: `src/web/client/styles.css`
- Modify: `src/web/test/client/document-viewer.test.ts`
- Modify: `src/web/e2e/dev.ts`
- Modify: `src/web/e2e/gig-board.e2e.ts`

**Interfaces:**
- Consumes: `GigRecord.documents: DocumentSummary[]`, `/api/documents/:id/versions/:version`, and `MarkdownRenderer`.
- Produces: `DocumentSummary.currentVersion: number`, `loadManagedDocumentVersion(reference, version)`, and a Gig drawer that requires no Gig artifact endpoint.

- [ ] **Step 1: Write the failing managed-summary test**

In `src/core/test/services.test.ts`, create a synthetic managed `job_description`, read its Gig, and assert:

```ts
expect(app.gigs.get(gigId)?.documents).toContainEqual({
  id: document.id,
  type: "job_description",
  title: "Synthetic Company — Director",
  displayName: "Synthetic Company — Director",
  currentVersion: 1,
});
```

- [ ] **Step 2: Run the core test to verify RED**

Run:

```bash
bun test src/core/test/services.test.ts --test-name-pattern "Gig document summaries expose current version"
```

Expected: FAIL because `DocumentSummary` omits `currentVersion`.

- [ ] **Step 3: Add the exact current version to document summaries**

Change the contract and mapper in `src/core/documents.ts`:

```ts
export interface DocumentSummary {
  id: string;
  type: ManagedDocumentType;
  title: string | null;
  displayName: string;
  currentVersion: number;
}

export const documentSummary = (document: ManagedDocumentRecord): DocumentSummary => ({
  id: document.id,
  type: document.documentType,
  title: document.title,
  displayName: document.displayName,
  currentVersion: document.currentVersion,
});
```

Keep `ManagedDocumentService.summaries()` as the single mapper used by Gig and Person reads.

- [ ] **Step 4: Write the failing client parser/loader tests**

In `src/web/test/client/document-viewer.test.ts`, add synthetic cases asserting that the shared parser:

```ts
expect(parseManagedDocumentViewData({
  reference: documentId,
  version: 2,
  storage: "managed",
  displayName: "Synthetic role",
  documentType: "job_description",
  mediaType: "text/markdown",
  currentVersion: 2,
  content: "# Synthetic role",
}, { reference: documentId, version: 2 })).toMatchObject({
  reference: documentId,
  version: 2,
  content: "# Synthetic role",
});
```

Also assert rejection when the reference or exact version differs.

- [ ] **Step 5: Run the client test to verify RED**

```bash
bun test src/web/test/client/document-viewer.test.ts
```

Expected: FAIL because `src/web/client/data/documents.ts` and its exports do not exist.

- [ ] **Step 6: Extract the managed-document web loader**

Create `src/web/client/data/documents.ts` with:

```ts
export interface ManagedDocumentViewData {
  reference: string;
  version: number;
  storage: "managed";
  displayName: string;
  documentType: string;
  mediaType: "text/markdown" | "text/plain";
  currentVersion: number;
  content: string;
}

export interface ManagedDocumentLocation {
  reference: string;
  version: number;
}

export function parseManagedDocumentViewData(
  value: unknown,
  expected: ManagedDocumentLocation,
): ManagedDocumentViewData {
  // Move the existing strict DocumentViewer validation here unchanged.
}

export async function loadManagedDocumentVersion(
  location: ManagedDocumentLocation,
): Promise<ManagedDocumentViewData> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(location.reference)}/versions/${location.version}`,
    { cache: "no-store" },
  );
  if (response.status === 404) throw new Error("This document version could not be found.");
  if (!response.ok) throw new Error("This document could not be opened.");
  return parseManagedDocumentViewData(await response.json(), location);
}
```

Refactor `DocumentViewer.tsx` to call this loader rather than retaining a second parser/fetch implementation.

- [ ] **Step 7: Change the Gig client type and drawer**

In `src/web/client/data/gigs.ts`, return `GigRecord[]` rather than `Gig[]`. In `App.tsx`, make `GigBoard`, `GigCard`, and `GigDrawer` use `GigRecord`/`GigSummary` consistently, and replace `GigArtifacts` state with managed-description state.

Select the document deterministically:

```ts
const description = gig.documents
  .filter(document => document.type === "job_description")
  .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
```

Load `{ reference: description.id, version: description.currentVersion }` through `loadManagedDocumentVersion`. Render Markdown with:

```tsx
<div className={`description-copy ${descriptionExpanded ? "is-expanded" : ""}`}>
  <MarkdownRenderer>{document.content}</MarkdownRenderer>
</div>
```

Render Open document as:

```tsx
<a
  href={`/documents/${encodeURIComponent(description.id)}/versions/${description.currentVersion}`}
  target="_blank"
  rel="noreferrer"
>
  Open document
</a>
```

Render Apply directly from `gig.sourceUrl`; remove the artifact-directory row and every drawer fetch to `/api/gigs/:id/artifacts`.

- [ ] **Step 8: Add the BECU-equivalent E2E fixture and assertion**

In `src/web/e2e/dev.ts`, seed a synthetic active Gig with a managed job description and no dependence on legacy flags. In `gig-board.e2e.ts`, add a test named `managed Gig description and canonical Apply link drive the drawer` that proves:

```ts
await expect(drawer.locator(".document-markdown h1")).toHaveText("Synthetic managed description");
await expect(drawer.getByRole("link", { name: "Open document" })).toHaveAttribute(
  "href",
  new RegExp(`/documents/${documentId}/versions/1$`),
);
await expect(drawer.getByRole("link", { name: /Apply/ })).toHaveAttribute(
  "href",
  "https://careers.example.test/jobs/SYN-149",
);
```

- [ ] **Step 9: Run focused GREEN verification**

```bash
bun test src/core/test/services.test.ts src/web/test/client/document-viewer.test.ts
bunx playwright test --config src/web/playwright.config.ts src/web/e2e/gig-board.e2e.ts --grep "managed Gig description"
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 10: Commit the managed-document drawer**

```bash
git add src/core/documents.ts src/core/test/services.test.ts src/web/client/data/documents.ts src/web/client/data/gigs.ts src/web/client/DocumentViewer.tsx src/web/client/App.tsx src/web/client/styles.css src/web/test/client/document-viewer.test.ts src/web/e2e/dev.ts src/web/e2e/gig-board.e2e.ts
git commit -m "feat: render Gig managed descriptions"
```

---

### Task 3: Remove the legacy Gig artifact subsystem

**Files:**
- Delete: `src/core/artifact-domain-service.ts`
- Delete: `src/data/artifacts.ts`
- Delete: `src/data/test/artifacts.test.ts`
- Modify: `src/core/models.ts`
- Modify: `src/core/gigs.ts`
- Modify: `src/core/gig-domain-service.ts`
- Modify: `src/core/ports.ts`
- Modify: `src/core/application.ts`
- Modify: `src/core/document-reader.ts`
- Modify: `src/core/index.ts`
- Modify: `src/data/schema.ts`
- Modify: `src/data/store.ts`
- Modify: `src/data/local-application.ts`
- Modify: `src/data/index.ts`
- Modify: `src/cli/cli.ts`
- Modify: `src/cli/db-store.ts`
- Modify: `src/cli/test/cli.test.ts`
- Modify: `src/web/request-handler.ts`
- Modify: affected synthetic fixtures under `src/core/test/`, `src/data/test/`, `src/web/test/`, and `src/agent/test/`
- Create: `src/data/migrations/0041_authoritative_gig_documents.sql`
- Create: `src/data/migrations/meta/0041_snapshot.json`
- Modify: `src/data/migrations/meta/_journal.json`
- Modify: `src/data/test/scout-migration.test.ts`

**Interfaces:**
- Consumes: the Task 2 drawer, which already reads managed documents.
- Produces: `Gig`, `GigData`, `GigFinderApplication`, and `ApplicationDocumentReader` with no Gig filesystem artifact dependency.

- [ ] **Step 1: Write a true-upgrade migration test**

In `src/data/test/scout-migration.test.ts`, create a database at migration 0040 with:

- one live Gig whose legacy flags are true;
- one deleted Gig;
- one `gig_history` update row;
- a linked managed job description and version; and
- child rows that exercise existing Gig foreign keys.

After applying 0041, assert:

```ts
expect(columnNames(database, "gigs")).not.toContain("has_job_description");
expect(columnNames(database, "gigs")).not.toContain("has_interview_prep");
expect(columnNames(database, "gig_history")).not.toContain("has_job_description");
expect(columnNames(database, "gig_history")).not.toContain("has_interview_prep");
expect(database.query("SELECT id, revision, is_deleted FROM gigs ORDER BY id").all()).toEqual(expectedGigs);
expect(database.query("SELECT id, revision, operation FROM gig_history").all()).toEqual(expectedHistory);
expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
```

Also verify the original indexes and CHECK constraints remain effective after the rebuild.

- [ ] **Step 2: Run the migration test to verify RED**

```bash
bun test src/data/test/scout-migration.test.ts --test-name-pattern "0041 removes Gig artifact projection"
```

Expected: FAIL because migration 0041 is absent.

- [ ] **Step 3: Remove legacy columns from the Drizzle schema and generate 0041**

Delete `hasJobDescription` and `hasInterviewPrep` from the shared Gig fields in `src/data/schema.ts`, then run:

```bash
bun run db:generate --name authoritative_gig_documents
```

Review the generated table rebuild. Preserve every non-artifact column, constraint, index, and foreign key. If Drizzle qualifies CHECK columns with a temporary table name, change those CHECK expressions to unqualified column names before testing the table rename.

- [ ] **Step 4: Remove the artifact fields from core and persistence contracts**

Remove these fields everywhere:

```ts
artifactDirectory
hasJobDescription
hasInterviewPrep
```

Specifically:

- remove the booleans from `GigData`, `GigSummary`, `gigEntitySchema`, `gigInputSchema`, `gigFromData`, and `gigToData`;
- remove their columns and boolean mapping from `gigColumns`/`configs.gigs`;
- remove `ArtifactPort` and `ArtifactVerification` from `ports.ts`;
- change `GigDomainService` to receive only `Persistence`, `ChangeExecutor`, and `ManagedDocumentService`;
- remove `GigDomainService.description()` and `.prep()`; and
- change `GigFinderApplication` so it no longer constructs or exposes `ArtifactDomainService`.

The intended constructors become:

```ts
new GigDomainService(persistence, changeExecutor, documents)
new GigFinderApplication(persistence, audit, defaultAgentModel)
```

- [ ] **Step 5: Make the document reader managed-only**

Change `DocumentReference` to the managed shape only, remove artifact reference parsing/hashing, and simplify Gig listing to:

```ts
const gig = this.services.gigs.get(entityId);
if (!gig) return [];
return (this.services.managed?.list("gig", entityId) ?? []).map(toReference);
```

`DocumentReaderServices.gigs` retains only `get(id)`. `get()` supports managed `doc_*` references and returns `not_found` for every other reference.

- [ ] **Step 6: Delete the subsystem and adapters**

Delete `src/core/artifact-domain-service.ts`, `src/data/artifacts.ts`, and `src/data/test/artifacts.test.ts`. Remove their barrel exports and remove `LocalArtifactStore` construction from `openLocalApplication`.

Keep `GigFinderContextPaths.artifacts`, the runtime artifact mount, Scout description storage, profile projection storage, `src/data/runtime-artifacts.ts`, and `src/operations/maintenance.ts` intact.

- [ ] **Step 7: Remove the Gig artifact HTTP and CLI paths**

Delete:

- `GET /api/gigs/:id/artifacts` from `request-handler.ts`;
- `gig-finder artifacts verify` and `gig-finder artifacts sync` from CLI usage and dispatch; and
- `verifyArtifacts`/`syncArtifacts` from `src/cli/db-store.ts`.

Update tests and constructors to stop supplying fake `ArtifactPort` objects. Do not add tests whose sole purpose is asserting a removed command or class remains absent.

- [ ] **Step 8: Run focused GREEN verification**

```bash
bun test src/data/test/scout-migration.test.ts src/core/test/services.test.ts src/core/test/read-services.test.ts src/data/test/store.test.ts src/cli/test/cli.test.ts src/web/test/request-handler.test.ts
bun run db:check
bun run typecheck
bun run architecture
```

Expected: all commands pass.

- [ ] **Step 9: Audit the removal boundary**

```bash
rg -n "hasJobDescription|has_job_description|hasInterviewPrep|has_interview_prep|ArtifactDomainService|ArtifactPort|LocalArtifactStore|/api/gigs/.*/artifacts|artifacts (verify|sync)" src
```

Expected: no production-code matches. Historical migrations before 0041 and historical Superpowers documents may retain their original text.

- [ ] **Step 10: Commit the subsystem removal**

Stage only the files listed in this task, including the generated 0041 SQL/snapshot/journal, then commit:

```bash
git commit -m "refactor: remove legacy Gig artifacts"
```

---

### Task 4: Keep position backfill inside Scout

**Files:**
- Modify: `src/core/scout/engine/positions.ts`
- Modify: `src/core/scout/engine/screening.ts`
- Modify: `src/core/scout/engine/test/screening.test.ts`
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/data/test/scout-run-store.test.ts`
- Modify: `src/data/schema.ts`
- Create: `src/data/migrations/0042_scout_backfill_state.sql`
- Create: `src/data/migrations/meta/0042_snapshot.json`
- Modify: `src/data/migrations/meta/_journal.json`
- Modify: `src/data/test/scout-migration.test.ts`
- Modify: `src/web/test/request-handler.test.ts`
- Modify: `src/web/e2e/gig-scout.e2e.ts`
- Modify: `src/web/app.ts`

**Interfaces:**
- Consumes: the existing Scout acquisition, relevance, and candidate-scoring stages.
- Produces: `prepareDescriptionCompletion(...): { descriptionId: string }`, `completeDescription(processingId, descriptionId, now)`, and backfill status without Gig-document projection fields.

- [ ] **Step 1: Write the failing processor test**

Replace the promoted-document processor fixtures with a test asserting that successful acquisition completes Scout description work directly:

```ts
const repository = new FakeProcessingRepository();
await new ScoutPositionProcessor(repository, model).process("processing-1");
expect(repository.events).toEqual([
  "descriptionInput",
  "acquireDescription",
  "prepareDescriptionCompletion",
  "completeDescription",
]);
expect(repository.completedDescription).toEqual({
  processingId: "processing-1",
  descriptionId: "description-1",
});
```

The constructor must not receive `ManagedDocumentService`.

- [ ] **Step 2: Write the failing store/backfill test**

In `scout-run-store.test.ts`, seed a promoted position with a linked managed document, run exact-position backfill acquisition to completion, and assert:

```ts
expect(application.documents.get(documentId)?.currentVersion).toBe(beforeVersion);
expect(application.documents.get(documentId)?.content).toBe(beforeContent);
expect(store.backfillStatus(runId)?.positions).toContainEqual(expect.objectContaining({
  positionId,
  descriptionOutcome: "corrected",
}));
```

Assert the backfill response no longer contains `gigDocuments`.

- [ ] **Step 3: Run the focused tests to verify RED**

```bash
bun test src/core/scout/engine/test/screening.test.ts src/data/test/scout-run-store.test.ts --test-name-pattern "backfill|description acquisition"
```

Expected: FAIL because the processor still coordinates managed-document projection.

- [ ] **Step 4: Simplify the processing contract and processor**

Remove `ScoutPromotedDescriptionWork` and `ScoutPromotedDescriptionOutcome`. Change the repository contract to:

```ts
prepareDescriptionCompletion(
  processingId: string,
  value: ScoutDescriptionResult,
  now: string,
): { descriptionId: string };

completeDescription(
  processingId: string,
  descriptionId: string,
  now: string,
): void;
```

The acquire branch becomes:

```ts
const input = this.repository.descriptionInput(processingId);
const result = await this.repository.acquireDescription(input);
const now = this.now();
const prepared = this.repository.prepareDescriptionCompletion(processingId, result, now);
this.repository.completeDescription(processingId, prepared.descriptionId, now);
return;
```

Remove managed-document imports, constructor injection, verification helpers, and projection-failure handling from `ScoutPositionProcessor`. Remove the document-service argument at its composition root in `src/web/app.ts`.

- [ ] **Step 5: Simplify Scout persistence and status**

Remove `promotedDescriptionWork`, `failDescriptionProjection`, every `document_projection_status` read/write, and the `gigDocuments` aggregate from `ScoutPositionBackfillStatus` and `backfillStatus()`.

`prepareDescriptionCompletion` still persists exact acquisition provenance in `scout_description_acquisitions`; it returns only the prepared description ID. `completeDescription` advances Scout relevance work and marks acquisition complete.

- [ ] **Step 6: Remove the obsolete projection column through 0042**

Delete `documentProjectionStatus` and its CHECK from `scoutPositionProcessing` in `schema.ts`, then run:

```bash
bun run db:generate --name scout_backfill_state
```

The generated migration must rebuild `scout_position_processing` while preserving all rows, unique/index definitions, and foreign keys from `scout_description_acquisitions` and `scout_position_processing_outbox`. Add a true-upgrade regression with populated parent and child rows and assert `PRAGMA foreign_key_check` is empty.

- [ ] **Step 7: Update API and E2E expectations**

Remove `gigDocuments` from request-handler fixtures and from the position-backfill E2E response type. Change the E2E assertion so backfill updates the current Scout description/evaluations while the linked managed document remains at its prior version and content.

- [ ] **Step 8: Run focused GREEN verification**

```bash
bun test src/core/scout/engine/test/screening.test.ts src/data/test/scout-run-store.test.ts src/data/test/scout-migration.test.ts src/web/test/request-handler.test.ts
bun run db:check
bun run typecheck
bun run architecture
```

Expected: all commands pass.

- [ ] **Step 9: Commit Scout-only backfill**

Stage only Task 4 files, including 0042 SQL/snapshot/journal, then commit:

```bash
git commit -m "refactor: keep position backfill in Scout"
```

---

### Task 5: Reapply completed positions through promotion retry

**Files:**
- Modify: `src/core/scout/engine/positions.ts`
- Modify: `src/core/scout/engine/scout-position-service.ts`
- Modify: `src/core/scout/engine/test/scout-position-service.test.ts`
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/data/test/scout-run-store.test.ts`
- Modify: `src/web/test/request-handler.test.ts`

**Interfaces:**
- Consumes: `GigDomainService.resolvePosting()`, `GigDomainService.acceptPosting()`, `ManagedDocumentService`, and the existing promotion retry HTTP route.
- Produces: a discriminated `ScoutPromotionWork` contract that represents either an unfinished attempt or a completed-position retry while carrying the entire current `NormalizedPosition`.

- [ ] **Step 1: Define the work contract in a failing service test**

Write tests using this intended union:

```ts
interface ScoutPromotionMaterial {
  positionId: string;
  observationId: string;
  descriptionId: string;
  actor: string;
  posting: NormalizedPosition;
  markdown: string;
  sourceDescription: string;
  sourceProvenance: ManagedDocumentSourceProvenance;
}

export type ScoutPromotionWork = ScoutPromotionMaterial & (
  | {
      kind: "attempt";
      changeId: string;
      resolution: PostingResolution;
    }
  | {
      kind: "completed_retry";
      linkedGigId: string;
    }
);
```

Add focused cases for:

- pending work following the unchanged attempt path;
- completed work resolving and updating the same linked Gig;
- closed, missing, or no-longer-matching linked Gigs;
- missing complete current Scout evidence;
- missing, changed, and unchanged managed descriptions;
- exact retry after the Gig change committed but before document completion;
- exact retry after the document change committed;
- unchanged Scout state, decision, and completed promotion row; and
- a later observation/description identity producing a different internal change ID.

- [ ] **Step 2: Run service tests to verify RED**

```bash
bun test src/core/scout/engine/test/scout-position-service.test.ts --test-name-pattern "completed promotion retry"
```

Expected: FAIL because completed promotion work is unavailable.

- [ ] **Step 3: Write the failing SQLite reconstruction tests**

In `scout-run-store.test.ts`, seed a completed promotion, then a newer successful observation/description/evaluation projection. Assert `promotionWork(positionId)` returns:

```ts
expect(work).toMatchObject({
  kind: "completed_retry",
  positionId,
  linkedGigId: gigId,
  observationId: currentObservationId,
  descriptionId: currentDescriptionId,
  posting: {
    company: "Synthetic Company",
    externalId: "SYN-149",
    canonicalUrl: "https://careers.example.test/jobs/SYN-149",
  },
  markdown: "# Current synthetic posting",
});
```

Assert the current Scout state, revision, current decision, and completed promotion row are byte-for-byte unchanged after reconstruction.

- [ ] **Step 4: Refactor current-posting reconstruction**

Extract the evidence binding currently embedded in `reviewPosting()` into a private method that reconstructs the latest complete successful posting for any state:

```ts
private currentPosting(positionId: string): ScoutPostingReview | null
```

`reviewPosting()` calls it and additionally requires `needs_user_review`. `promotionWork()` first returns existing pending/failed attempt work as `kind: "attempt"`; otherwise, for a promoted position with a completed promotion and linked Gig, it returns `kind: "completed_retry"` using `currentPosting()`.

The store reads only `scout_*` tables and the linked Gig ID foreign-key value. It does not query `gigs`, `gig_history`, or managed-document tables.

- [ ] **Step 5: Refactor one shared promotion operation**

In `ScoutPositionService`, split orchestration into:

```ts
private applyPromotion(
  work: ScoutPromotionMaterial,
  resolution: PostingResolution,
  changeId: string,
  completion: "record_attempt" | "completed_retry",
  now: string,
): ScoutPursueResult
```

Initial Pursue and pending/failed retry call it with `record_attempt`. Completed retry:

1. calls `gigs.resolvePosting(work.posting)`;
2. selects only `work.linkedGigId`;
3. rejects a missing or closed candidate through the existing invalid/validation outcome;
4. builds a current `use_existing` resolution from the returned fingerprint and candidate revision; and
5. calls `applyPromotion(..., "completed_retry", now)`.

Derive the internal completed-retry change ID in core:

```ts
const retryChangeId = `scout-promotion-retry:${createHash("sha256")
  .update([work.positionId, work.linkedGigId, work.observationId, work.descriptionId].join("\0"))
  .digest("hex")}`;
```

Use actor `Gig Scout`, source `automation`, and a summary naming completed promotion retry.

- [ ] **Step 6: Preserve attempt behavior and Scout state**

Inside `applyPromotion`:

- both modes call `GigDomainService.acceptPosting()` and the existing document coordinator;
- `record_attempt` retains existing `releasePromotion`, `failPromotion`, and `completePromotion` behavior;
- `completed_retry` performs none of those Scout writes and returns the current `positionDetail` after success, stale resolution, or invalid resolution; and
- caught Gig/document failures are rethrown without writing to the completed promotion row.

Do not create a second document mutation helper. Keep `coordinateDocument`, `createdByChange`, `versionByChange`, current-content no-op, and replay verification shared by both modes.

- [ ] **Step 7: Verify the existing HTTP contract**

Extend `request-handler.test.ts` so a POST to the existing retry URL returns HTTP 202 and the existing body:

```ts
{
  status: "updated",
  position: expect.objectContaining({ id: positionId, state: "promoted" }),
}
```

Also prove the route accepts no new request body and existing pending/stale fixtures still return their prior contract.

- [ ] **Step 8: Run focused GREEN verification**

```bash
bun test src/core/scout/engine/test/scout-position-service.test.ts src/data/test/scout-run-store.test.ts src/web/test/request-handler.test.ts
bun run typecheck
bun run architecture
```

Expected: all commands pass.

- [ ] **Step 9: Commit completed promotion retry**

```bash
git add src/core/scout/engine/positions.ts src/core/scout/engine/scout-position-service.ts src/core/scout/engine/test/scout-position-service.test.ts src/data/scout-run-store.ts src/data/test/scout-run-store.test.ts src/web/test/request-handler.test.ts
git commit -m "feat: retry completed Scout promotions"
```

---

### Task 6: Prove the complete repair flow

**Files:**
- Modify: `src/web/e2e/dev.ts`
- Modify: `src/web/e2e/gig-board.e2e.ts`
- Modify: `src/web/e2e/gig-scout.e2e.ts`
- Modify: any focused test fixture still carrying removed Gig artifact fields

**Interfaces:**
- Consumes: Tasks 2–5 as one integrated feature.
- Produces: synthetic BECU- and Providence-equivalent regressions and final branch verification evidence.

- [ ] **Step 1: Add the Providence-equivalent synthetic fixture**

Create a promoted synthetic position/Gig pair where:

- the Gig initially stores `https://search.example.test/api/jobs?tenant=synthetic`;
- the current observation canonical URL is `https://careers.example.test/jobs/SYN-149`;
- the managed job description is absent or at older Markdown;
- the Scout position is already promoted and linked to that exact Gig; and
- current Scout description/evaluations are complete.

- [ ] **Step 2: Write the integrated E2E repair test**

The test must:

1. open the Gig and confirm the initial Apply URL is the synthetic broken search URL;
2. run exact-position backfill with a corrected current Scout description;
3. prove the Gig URL and managed document are unchanged after backfill;
4. POST the existing `/promotion/retry` endpoint for the exact position;
5. reopen the Gig and prove Apply now uses the canonical posting URL;
6. prove the current managed description renders in the drawer and Open document loads the same exact version;
7. prove the position remains promoted and linked to the same Gig; and
8. repeat retry and prove Gig revision/document version counts do not increase again.

Use API reads for identity/version assertions and browser assertions for the user-visible drawer and links.

- [ ] **Step 3: Add changed and unchanged Markdown branches**

Use two synthetic promoted positions:

- one missing/changed description, which gains exactly one document/version; and
- one with identical current Markdown, which retains its current version.

Assert user-authored document title/metadata remain unchanged for the existing-document case.

- [ ] **Step 4: Run the focused E2E tests**

```bash
bunx playwright test --config src/web/playwright.config.ts src/web/e2e/gig-board.e2e.ts src/web/e2e/gig-scout.e2e.ts --grep "managed Gig description|completed promotion retry"
```

Expected: all selected scenarios pass with no browser console errors.

- [ ] **Step 5: Run the full required matrix**

```bash
bun run db:check
bun run check
bun run build
bun run test:e2e
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Run boundary and privacy audits**

```bash
rg -n "JOIN (gigs|gig_history|managed_documents|managed_document_versions)|UPDATE (gigs|gig_history|managed_documents|managed_document_versions)|INSERT INTO (gigs|gig_history|managed_documents|managed_document_versions)" src/data/scout-run-store.ts
rg -n "hasJobDescription|has_job_description|hasInterviewPrep|has_interview_prep|ArtifactDomainService|ArtifactPort|LocalArtifactStore" src
git status --short
```

Expected: the Scout store contains no cross-domain read/mutation SQL; legacy Gig artifact names are absent from production source; status contains only intentional issue files plus preserved user-owned changes.

- [ ] **Step 7: Commit integrated regressions**

```bash
git add src/web/e2e/dev.ts src/web/e2e/gig-board.e2e.ts src/web/e2e/gig-scout.e2e.ts
git commit -m "test: cover promoted Gig repair"
```

If fixture cleanup touched additional tracked tests, stage those exact files explicitly rather than using `git add -A`.

---

### Task 7: Review, release, and repair production records

**Files:**
- Modify only when review finds a concrete defect.
- Produce ignored evidence under `tmp/`; never track production metadata.

**Interfaces:**
- Consumes: a clean feature branch with all Task 6 gates passing.
- Produces: PR review evidence, immutable deployment, and verified exact-position production repair.

- [ ] **Step 1: Reconcile branch and open/update the PR**

```bash
git fetch origin
git merge --no-edit origin/main
bun run db:check
bun run check
bun run build
bun run test:e2e
git push origin issue-149-gig-description-apply
```

Open or update the PR with `Closes #149`, the spec and plan links, migration notes, synthetic evidence, and an explicit statement that existing filesystem contents remain untouched.

- [ ] **Step 2: Execute the Superpowers review loop**

Use `superpowers:requesting-code-review`. Fix every accepted finding with a RED/GREEN regression, rerun affected tests, and repeat review until the exact PR head has no Critical/Important findings. A later commit invalidates prior review evidence.

- [ ] **Step 3: Produce the exact-head release artifacts**

Run the repository's `change-overview` and `release-verifier` agents against the same exact PR SHA. Release verification must include:

```bash
bun run db:check
bun run check
bun run build
bun run test:e2e
bun run smoke:deterministic
bun run smoke:live
```

Update the PR evidence with the exact 40-character SHA. Watch required GitHub checks with:

```bash
gh pr checks --watch
```

- [ ] **Step 4: Merge and deploy through the release workflow**

Use the `deployer` agent only after exact-head review, release verification, change overview, and required checks are current. Merge the reviewed head, wait for exact-main validation and immutable multi-arch image publication, update the operator checkout to the merge SHA, and deploy that exact image with `bin/deploy-local.sh`.

Verify exact revision, health, SQLite integrity, foreign keys, queue reconciliation, restart count, logs, and mounts before production repair.

- [ ] **Step 5: Build the exact repair set with existing read APIs**

Read non-deleted, non-closed Gigs and promoted positions from production. Write only bounded metadata to an ignored `tmp/issue-149-production-repair.json`:

```json
[
  {
    "positionId": "spos_<exact-id>",
    "gigId": "gig_<exact-id>",
    "currentGigUrl": "https://…",
    "currentPostingUrl": "https://…",
    "managedDocumentId": "doc_<exact-id-or-null>"
  }
]
```

Include only reviewed exact linked pairs. Exclude closed/deleted Gigs and positions without complete current Scout evidence. Do not include description content, private configuration, or source payloads.

- [ ] **Step 6: Retry each exact completed promotion**

For each reviewed `positionId`, call the existing loopback endpoint once:

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  "http://127.0.0.1:3001/api/gig-scout/positions/${positionId}/promotion/retry"
```

Require the existing `updated` result before continuing to the next exact ID. Stop on stale, invalid, validation, HTTP, or infrastructure failure; do not bypass the domain operation with SQL.

- [ ] **Step 7: Verify production repair and close the issue**

For every successful exact ID, verify through existing reads that:

- the position remains promoted and linked to the original Gig;
- the Gig's posting-owned fields match the current Scout posting;
- Apply uses the canonical official URL;
- the linked managed job description exists and its current version renders;
- unchanged Markdown did not create another version; and
- database integrity and foreign keys remain clean.

Delete the ignored repair metadata after verification. Mark issue #149 Done only after production UI and exact repaired records are verified.

# Scout Gig Availability Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route trustworthy Scout company-result availability changes through a generic, audited Gig-domain mutation without allowing Scout persistence to update Gig tables.

**Architecture:** Extend `ScoutRunService` to prepare a company result through the Scout store, reconcile tracked Gigs through `GigDomainService.setAvailability`, and only then complete the company result. The Gig service owns availability state, revisions, history, and audit; the Scout store owns only Scout evidence and run state. A migration renames the existing availability columns and removes the redundant Scout-specific history table.

**Tech Stack:** Bun, TypeScript, Zod, SQLite, Drizzle ORM/Kit, BunQueue, dependency-cruiser, Bun test.

**Spec:** `docs/superpowers/specs/2026-08-26-scout-gig-availability-domain-design.md`

## Global Constraints

- Use strict red-green-refactor TDD.
- Keep the existing trustworthy-company-result classification and exact Gig identity rules unchanged.
- `GigDomainService.setAvailability` must not accept Scout run, company, source, or position types.
- `SqliteScoutRunStore` must not query or mutate Gig tables or write Gig audit/history records.
- Unchanged availability must create no revision, history row, or change row.
- Company/run success must remain nonterminal until required Gig mutations complete.
- Do not run Scout in production before the corrected release is deployed.
- Update product and architecture documentation in the same change.
- Use synthetic fixtures only; do not commit production data, database files, logs, or backups.

---

### Task 1: Make availability an audited Gig-domain property

**Files:**
- Modify: `src/core/models.ts`
- Modify: `src/core/gigs.ts`
- Modify: `src/core/tracker-services.ts`
- Modify: `src/core/test/services.test.ts`
- Modify: `src/data/store.ts`
- Modify: `src/data/schema.ts`
- Create: `src/data/migrations/0034_gig_domain_availability.sql`
- Create: `src/data/migrations/meta/0034_snapshot.json`
- Modify: `src/data/migrations/meta/_journal.json`
- Modify: `src/data/test/scout-migration.test.ts`
- Modify: `src/data/test/store.test.ts`

**Interfaces:**
- Produces: `GigAvailability = "unknown" | "available" | "unavailable"`.
- Produces: `GigDomainService.setAvailability(context: ChangeContext, gigId: string, availability: Exclude<GigAvailability, "unknown">): MutationResult<GigRecord>`.
- Produces: persisted `GigData.availability` and `GigData.availabilityUpdatedAt` fields mapped to `availability` and `availability_updated_at` in both `gigs` and `gig_history`.
- Consumes: existing `ChangeExecutor`, `Persistence`, revision-checked Gig repository, and `ChangeContext`.

- [ ] **Step 1: Write failing Gig-domain tests**

Add focused tests in `src/core/test/services.test.ts` that seed a Gig and call:

```ts
const changed = app.gigs.setAvailability(
  {
    actor: "Synthetic Scout",
    source: "automation",
    summary: "Observed official position availability",
    changeId: "scout-availability:run-1:gig-1",
    occurredAt: "2026-08-27T12:00:00Z",
  },
  "gig-1",
  "available",
);

expect(changed).toMatchObject({
  changeId: "scout-availability:run-1:gig-1",
  record: {
    availability: "available",
    availabilityUpdatedAt: "2026-08-27T12:00:00Z",
    revision: 2,
  },
});
```

Add a second assertion that the same requested availability returns `changeId: null` and leaves the revision unchanged. Add validation coverage proving `gigInputSchema` rejects `availability` and `availabilityUpdatedAt` in ordinary create/update input.

- [ ] **Step 2: Run the focused core test and verify RED**

Run: `bun test src/core/test/services.test.ts`

Expected: FAIL because the Gig record has no domain availability fields and `setAvailability` does not exist.

- [ ] **Step 3: Add domain types and the minimal service mutation**

In `src/core/gigs.ts`, define the domain-owned fields outside `gigMutableFields` so ordinary `GigInput` cannot contain them:

```ts
export const gigAvailabilities = ["unknown", "available", "unavailable"] as const;
export type GigAvailability = (typeof gigAvailabilities)[number];

const gigAvailabilityFields = {
  availability: z.enum(gigAvailabilities),
  availabilityUpdatedAt: z.string().datetime().nullable(),
};

export const gigEntitySchema = z.object({
  id: z.string().trim().min(1),
  ...gigMutableFields,
  ...gigAvailabilityFields,
  artifactDirectory: z.string().nullable(),
  hasJobDescription: z.boolean(),
  hasInterviewPrep: z.boolean(),
}).strict();
```

Add required `availability` and `availabilityUpdatedAt` fields to persisted
`Gig`/`GigRecord` and `GigData`. Keep them optional on the legacy
`GigSummary` construction shape, and make `gigToData`, `create`, and
`createNew` supply `"unknown"`/`null` when omitted. Update `gigFromData` so
every returned domain record has both fields.

Implement in `GigDomainService`:

```ts
setAvailability(
  context: ChangeContext,
  id: string,
  availability: Exclude<GigAvailability, "unknown">,
): MutationResult<GigRecord> {
  const current = this.get(id);
  if (!current) throw new Error(`Gig not found: ${id}`);
  if (current.availability === availability) {
    return { record: current, changeId: null };
  }
  const occurredAt = context.occurredAt ?? new Date().toISOString();
  const raw = this.p.gigs.get(id)!;
  const candidate = {
    ...current,
    availability,
    availabilityUpdatedAt: occurredAt,
  };
  return this.changes.execute(context, candidate, {}, transaction =>
    this.record(transaction.gigs.update(id, raw.revision, {
      availability,
      availabilityUpdatedAt: occurredAt,
    })),
  );
}
```

Parse or explicitly validate the requested value before mutation so values outside `available|unavailable` fail at the domain boundary.

- [ ] **Step 4: Add the migration and typed persistence mapping**

Create migration 0034 with these operations in order:

```sql
ALTER TABLE gigs RENAME COLUMN scout_availability TO availability;
--> statement-breakpoint
ALTER TABLE gigs RENAME COLUMN scout_availability_updated_at TO availability_updated_at;
--> statement-breakpoint
ALTER TABLE gig_history RENAME COLUMN scout_availability TO availability;
--> statement-breakpoint
ALTER TABLE gig_history RENAME COLUMN scout_availability_updated_at TO availability_updated_at;
--> statement-breakpoint
DROP TABLE scout_gig_availability_history;
```

Map the renamed fields in `src/data/schema.ts` and add them to `gigColumns` in `src/data/store.ts`. Generate the Drizzle snapshot/journal entry with `bun run db:generate`, inspect the generated SQL, and keep exactly one 0034 migration/snapshot/journal leaf. If Drizzle emits table-copy SQL instead of the five intended statements, preserve its valid snapshot metadata but replace the SQL with the reviewed statements above.

- [ ] **Step 5: Write migration and history integration tests**

In `src/data/test/scout-migration.test.ts`, migrate through 0033, insert synthetic non-default values into both old columns, apply 0034, and assert:

```ts
expect(columnNames(database, "gigs")).toEqual(
  expect.arrayContaining(["availability", "availability_updated_at"]),
);
expect(columnNames(database, "gigs")).not.toContain("scout_availability");
expect(tableNames(database)).not.toContain("scout_gig_availability_history");
expect(database.query(
  "SELECT availability, availability_updated_at FROM gigs WHERE id='gig-1'",
).get()).toEqual({
  availability: "available",
  availability_updated_at: "2026-08-20T12:00:00Z",
});
```

In `src/data/test/store.test.ts`, use the real `GigFinderApplication` and assert the changed availability produces one `changes` row, a complete revision-1 `gig_history` snapshot with prior `unknown/null`, and a live revision-2 Gig with `available/timestamp`. Repeat the call and assert all counts and the live revision remain unchanged.

- [ ] **Step 6: Run focused tests and database validation**

Run:

```bash
bun test src/core/test/services.test.ts src/data/test/store.test.ts src/data/test/scout-migration.test.ts
bun run db:check
bun run architecture
```

Expected: all PASS; the migration chain and snapshot are valid.

- [ ] **Step 7: Commit the Gig-domain slice**

```bash
git add src/core/models.ts src/core/gigs.ts src/core/tracker-services.ts \
  src/core/test/services.test.ts src/data/store.ts src/data/schema.ts \
  src/data/migrations/0034_gig_domain_availability.sql \
  src/data/migrations/meta/0034_snapshot.json \
  src/data/migrations/meta/_journal.json \
  src/data/test/scout-migration.test.ts src/data/test/store.test.ts
git commit -m "fix: own availability in the gig domain"
```

---

### Task 2: Split Scout company-result persistence into preparation and completion

**Files:**
- Modify: `src/core/scout/engine/runs.ts`
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/data/test/scout-run-store.test.ts`
- Modify: `src/core/scout/engine/test/runs.test.ts`
- Modify: `src/operations/test/scout-runtime.integration.test.ts`

**Interfaces:**
- Produces: `PreparedScoutCompanyResult` with `companyName`, `status`, and exact `observedPositions`.
- Produces: `ScoutRunStore.prepareCompanyResult(job, result, now): PreparedScoutCompanyResult`.
- Produces: `ScoutRunStore.completeCompanyResult(job, prepared, now): void`.
- Produces during this slice: a compatibility `ScoutRunStore.commitResult`
  wrapper that calls preparation and completion without availability
  reconciliation, solely so the unchanged runtime compiles. Task 3 must remove
  this wrapper and the interface member when it switches the runtime to
  `ScoutRunService.commitCompanyResult`.
- Consumes: existing source-attempt classification, observation persistence, processing outbox creation, and run finalization behavior.

- [ ] **Step 1: Write failing store tests for a nonterminal prepared result**

Refactor the synthetic result fixture in `src/data/test/scout-run-store.test.ts` and add assertions:

```ts
const prepared = store.prepareCompanyResult(job, result, observedAt);

expect(prepared).toEqual({
  companyName: "Synthetic Company",
  status: "succeeded",
  observedPositions: [{
    canonicalUrl: "https://careers.example.test/jobs/1",
    externalId: "job-1",
  }],
});
expect(runCompanyStatus(database, job.runCompanyId)).toBe("queued");

store.completeCompanyResult(job, prepared, completedAt);
expect(runCompanyStatus(database, job.runCompanyId)).toBe("succeeded");
```

Also call `prepareCompanyResult` twice and prove attempts, observations, processing rows, and outbox rows are not duplicated.

- [ ] **Step 2: Run the focused store test and verify RED**

Run: `bun test src/data/test/scout-run-store.test.ts`

Expected: FAIL because the split persistence methods do not exist.

- [ ] **Step 3: Add exact preparation/completion contracts**

In `runs.ts`, define:

```ts
export type ScoutCompanyResultStatus = "succeeded" | "partial" | "failed";

export interface PreparedScoutCompanyResult {
  companyName: string;
  status: ScoutCompanyResultStatus;
  observedPositions: Array<{
    canonicalUrl: string;
    externalId: string | null;
  }>;
}
```

Replace the store's business-level `commitResult` contract with:

```ts
prepareCompanyResult(
  job: ScoutCompanyJob,
  result: CompanyScanResult,
  now: string,
): PreparedScoutCompanyResult;
completeCompanyResult(
  job: ScoutCompanyJob,
  result: PreparedScoutCompanyResult,
  now: string,
): void;
```

Keep `commitResult(job, result, now)` as a clearly marked compatibility method
in the interface and SQLite store for this commit only. Its implementation is
exactly `completeCompanyResult(job, prepareCompanyResult(job, result, now),
now)`. Task 3 removes it after changing the sole production caller.

- [ ] **Step 4: Refactor `SqliteScoutRunStore` without changing classification**

Move the existing result/source/attempt/observation writes into `prepareCompanyResult`. Keep the current status derivation byte-for-byte equivalent, but do not update `scout_run_companies` to a terminal status and do not call `finalize` there. Return the stored company name and distinct accepted identities from the current result.

Move the terminal company update and `finalize(job.runId, now)` into `completeCompanyResult`. Make completion conditional on the company still being nonterminal and make replay a no-op when the same company is already terminal.

Delete `reconcileCompanyAvailability` and every Scout-store SQL statement that reads or writes `gigs`, `gig_history`, `changes`, or `scout_gig_availability_history` for availability. Do not alter the independent position-stage `reconcileGig` behavior in this task.

- [ ] **Step 5: Add regression coverage for no Gig mutation in preparation**

Seed a tracked Gig, prepare a trustworthy result, and assert its availability, revision, `changes` count, and `gig_history` count remain unchanged before and after Scout-store completion. This proves persistence no longer performs the cross-domain mutation; Task 3 will prove core orchestration does.

Update all `ScoutRunStore` fakes in `runs.test.ts` and `scout-runtime.integration.test.ts` with the two new methods, returning a bounded synthetic prepared result.

- [ ] **Step 6: Run focused tests and architecture checks**

Run:

```bash
bun test src/data/test/scout-run-store.test.ts src/core/scout/engine/test/runs.test.ts src/operations/test/scout-runtime.integration.test.ts
bun run architecture
```

Expected: all PASS and dependency-cruiser reports no data-to-core-service orchestration.

- [ ] **Step 7: Commit the Scout persistence split**

```bash
git add src/core/scout/engine/runs.ts src/data/scout-run-store.ts \
  src/data/test/scout-run-store.test.ts \
  src/core/scout/engine/test/runs.test.ts \
  src/operations/test/scout-runtime.integration.test.ts
git commit -m "refactor: separate scout result preparation from completion"
```

---

### Task 3: Orchestrate availability through `ScoutRunService`

**Files:**
- Modify: `src/core/scout/engine/runs.ts`
- Modify: `src/core/scout/engine/test/runs.test.ts`
- Modify: `src/operations/scout-runtime.ts`
- Modify: `src/operations/test/scout-runtime.integration.test.ts`
- Modify: `src/data/local-application.ts`
- Modify: `src/web/app.ts`

**Interfaces:**
- Consumes: `PreparedScoutCompanyResult`, `ScoutRunStore.prepareCompanyResult`, `ScoutRunStore.completeCompanyResult`, and `GigDomainService.setAvailability` from Tasks 1–2.
- Produces: `ScoutRunService.commitCompanyResult(job, result, now): void`.
- Produces: a runtime dependency shaped as `Pick<ScoutRunService, "commitCompanyResult">` for business completion while retaining a narrow Scout job-store dependency for queue recovery.

- [ ] **Step 1: Write failing `ScoutRunService` orchestration tests**

Use a fake store and fake Gig capability in `runs.test.ts`. Cover these cases separately:

```ts
const calls: string[] = [];
await service.commitCompanyResult(job, succeededResult, now);
expect(gigs.setAvailability).toHaveBeenCalledWith(
  expect.objectContaining({
    actor: "Gig Scout",
    source: "automation",
    changeId: `scout-availability:${job.runId}:gig-1`,
    occurredAt: now,
  }),
  "gig-1",
  "available",
);
expect(calls).toEqual(["setAvailability:gig-1", "completeCompanyResult"]);
```

Add cases proving:

- exact canonical URL or exact external ID under the prepared company makes the Gig `available`;
- a tracked Gig absent from a trustworthy successful result becomes `unavailable`;
- Gigs without either identity are skipped;
- deleted or different-company Gigs are excluded by the Gig service's active list;
- partial and failed prepared results make no Gig calls but still complete with their original status;
- a thrown Gig mutation prevents `completeCompanyResult`;
- retry after one successful mutation calls the same deterministic IDs, receives an unchanged result for the first Gig, updates the remainder, and completes once.

- [ ] **Step 2: Run the focused core test and verify RED**

Run: `bun test src/core/scout/engine/test/runs.test.ts`

Expected: FAIL because `ScoutRunService` does not accept a Gig capability or expose `commitCompanyResult`.

- [ ] **Step 3: Inject the generic Gig capability and implement orchestration**

Add a narrow port in `runs.ts` rather than importing persistence:

```ts
export interface ScoutGigAvailabilityPort {
  list(): GigRecord[];
  setAvailability(
    context: ChangeContext,
    gigId: string,
    availability: "available" | "unavailable",
  ): MutationResult<GigRecord>;
}
```

Extend the service constructor with this port. Implement:

```ts
commitCompanyResult(
  job: ScoutCompanyJob,
  result: CompanyScanResult,
  now: string,
): void {
  const prepared = this.store.prepareCompanyResult(job, result, now);
  if (prepared.status === "succeeded") {
    const observed = prepared.observedPositions;
    for (const gig of this.gigs.list()) {
      if (gig.company.trim().toLocaleLowerCase() !==
          prepared.companyName.trim().toLocaleLowerCase()) continue;
      if (!gig.sourceUrl && !gig.externalJobId) continue;
      const available = observed.some(position =>
        (gig.sourceUrl !== null && position.canonicalUrl === gig.sourceUrl) ||
        (gig.externalJobId !== null && position.externalId === gig.externalJobId),
      );
      this.gigs.setAvailability(
        {
          actor: "Gig Scout",
          source: "automation",
          summary: "Observed official position availability",
          changeId: `scout-availability:${job.runId}:${gig.id}`,
          occurredAt: now,
        },
        gig.id,
        available ? "available" : "unavailable",
      );
    }
  }
  this.store.completeCompanyResult(job, prepared, now);
}
```

Keep this method synchronous because the existing store and Gig service are synchronous. Do not add queue logic or SQL to core.

- [ ] **Step 4: Route runtime completion through the existing service**

Change `ScoutRuntime` to receive two dependencies:

```ts
constructor(
  private readonly jobs: Pick<ScoutRunStore,
    "pendingJobs" | "nonterminalJobs" | "markDispatched" |
    "commitInfrastructureFailure"
  >,
  private readonly runs: Pick<ScoutRunService, "commitCompanyResult">,
  options: ScoutRuntimeOptions,
)
```

Use `jobs` only for transport recovery/failure state and replace:

```ts
this.store.commitResult(payload, result, new Date().toISOString());
```

with:

```ts
this.runs.commitCompanyResult(payload, result, new Date().toISOString());
```

Update `openLocalApplication` to construct one `ScoutRunService(scoutStore, application.gigs, defaults)`. Update `src/web/app.ts` to pass `local.scoutStore` and `local.scout` into `ScoutRuntime`.

- [ ] **Step 5: Add runtime integration coverage for failure and recovery**

Update the embedded-queue integration test so the fake run service throws after the first Gig-side effect, then succeeds on retry. Assert the queue records the company job as complete only after the service succeeds and that the runtime never calls a store-level business `commitResult` method.

- [ ] **Step 6: Run focused and full Scout tests**

Run:

```bash
bun test src/core/scout/engine/test/runs.test.ts \
  src/data/test/scout-run-store.test.ts \
  src/operations/test/scout-runtime.integration.test.ts
bun run architecture
```

Expected: all PASS; operations contains queue coordination only, core owns availability decisions, and data owns no Gig mutation.

- [ ] **Step 7: Commit the orchestration slice**

```bash
git add src/core/scout/engine/runs.ts \
  src/core/scout/engine/test/runs.test.ts \
  src/operations/scout-runtime.ts \
  src/operations/test/scout-runtime.integration.test.ts \
  src/data/local-application.ts src/web/app.ts
git commit -m "fix: route scout availability through gig domain"
```

---

### Task 4: Record and enforce the architecture decision

**Files:**
- Create: `docs/architecture/decisions/0016-own-domain-table-mutations.md`
- Modify: `docs/architecture/decisions/0014-separate-scout-discovery-from-position-processing.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/product/006-gig-scout.md`
- Review: `.dependency-cruiser.cjs`

**Interfaces:**
- Consumes: the final ownership and data flow implemented in Tasks 1–3.
- Produces: accepted ADR 0016 and minimal ADR 0014/FRR-006 clarification.
- Produces no new runtime API.

- [ ] **Step 1: Write ADR 0016 as the repository-wide ownership rule**

Create a short accepted ADR with this decision:

```md
# ADR 0016: Mutate domain-owned tables through the owning domain service

**Status:** Accepted
**Date:** 2026-08-27

## Context

Revision and audit transactions are insufficient when another domain or its
persistence adapter reproduces a domain mutation directly. That bypass can
omit validation, history, or related invariants while appearing successful.

## Decision

- Each mutable table has one owning domain.
- Mutations enter through that domain's service and its repository ports.
- Another domain requests a capability from the owning service; it does not
  reproduce SQL, revision, history, or audit behavior.
- Persistence adapters implement storage for their own domain and do not
  orchestrate another domain's service.
- Read-only cross-domain access requires an explicit read contract and does
  not grant mutation ownership.
- Dependency-cruiser enforces detectable service-module boundaries; tests and
  review cover semantic bypasses such as duplicated SQL.

The current ownership map is:

| Domain | Owned tables |
| --- | --- |
| Change audit | `changes`, `creation_idempotency` |
| Application settings | `application_settings` |
| Conversations | `conversations`, `conversation_history`, `conversation_messages` |
| Gigs | `gigs`, `gig_history` |
| People and Gig relationships | `people`, `person_history`, `gig_people`, `gig_people_history`, `legacy_person_follow_up_archive` |
| Tasks | `tasks`, `task_history` |
| Interactions | `interactions`, `interaction_history`, `interaction_participants`, `interaction_participant_history`, `interaction_sources`, `interaction_legacy_refs` |
| Business events | `business_events`, `event_sources` |
| Managed documents and candidate profile | `managed_documents`, `managed_document_versions`, `managed_document_links`, `candidate_profiles` |
| Scout | every `scout_*` table except foreign-key references to another domain's rows |

New mutable tables must be assigned to an owning domain in the ADR or in a
later ADR that amends this map.

## Consequences

- Cross-domain workflows are orchestrated in core services.
- Composition roots wire services and ports without owning business logic.
- A mutation may require an explicit domain capability rather than direct SQL.
```

- [ ] **Step 2: Make the minimal ADR 0014 amendment**

Replace only the availability clause in the company-discovery decision with language equivalent to:

```md
A successful company job persists positions and observations, then
`ScoutRunService` requests required tracked-position availability changes from
the Gig domain before marking the company result complete. It creates
downstream position work without waiting for position processing.
```

Do not change the position-processing queue decision.

- [ ] **Step 3: Update the architecture overview and FRR-006**

Add the ADR 0016 link to `docs/architecture/overview.md`. In FRR-006, add acceptance criteria stating that a trustworthy successful company result updates tracked Gig availability through the Gig domain; partial, failed, unsupported, and suspiciously empty results do not; availability does not close the Gig or alter pipeline stage/outcome.

- [ ] **Step 4: Verify dependency-cruiser coverage**

Inspect `.dependency-cruiser.cjs` and confirm the existing `data-does-not-orchestrate-core-services` rule rejects imports of `GigDomainService` from data adapters while allowing `src/data/local-application.ts`. Do not add a source-text test or a redundant rule if the current rule already enforces that import boundary. Run `bun run architecture` and manually inspect `src/data/scout-run-store.ts` to confirm there is no SQL targeting `gigs`, `gig_history`, or Gig audit writes.

- [ ] **Step 5: Run documentation and architecture checks**

Run:

```bash
bun run architecture
bun run check
```

Expected: PASS with ADR 0016 linked and no undocumented behavior conflict.

- [ ] **Step 6: Commit the documentation slice**

```bash
git add docs/architecture/decisions/0016-own-domain-table-mutations.md \
  docs/architecture/decisions/0014-separate-scout-discovery-from-position-processing.md \
  docs/architecture/overview.md docs/product/006-gig-scout.md
git commit -m "docs: require domain-owned mutations"
```

---

### Task 5: Verify the complete fix and prepare the pull request

**Files:**
- Modify only if verification exposes a defect in files already listed above.
- Do not modify production data, deployment state, or unrelated documentation.

**Interfaces:**
- Consumes: all deliverables from Tasks 1–4.
- Produces: a reviewed PR linked with `Closes #140`, exact-head evidence, and no deployment from the implementation worker.

- [ ] **Step 1: Run the full local verification suite**

Run sequentially:

```bash
bun run check
bun run db:check
bun run build
bun run test:e2e
```

Expected: all PASS. If any command fails, diagnose and fix the underlying defect, rerun the focused regression first, then rerun this complete sequence.

- [ ] **Step 2: Audit the final diff**

Run:

```bash
git diff --check main...HEAD
git status --short
rg -n "UPDATE gigs|INSERT INTO gig_history|scout_gig_availability_history" src/data/scout-run-store.ts
```

Expected: clean diff, only planned files changed, and the final `rg` returns no matches.

- [ ] **Step 3: Push and open the linked PR**

```bash
git push -u origin issue-140-scout-gig-availability
gh pr create --base main --head issue-140-scout-gig-availability \
  --title "Issue #140: route Scout availability through the Gig domain" \
  --body "Closes #140"
```

- [ ] **Step 4: Request independent review and resolve findings**

Use `superpowers:requesting-code-review`. Require the reviewer to inspect:

- the generic Gig capability and complete history snapshot;
- exact identity and trustworthy-result behavior;
- retry after partial Gig reconciliation;
- absence of Gig mutation in `SqliteScoutRunStore`;
- migration preservation/removal behavior;
- ADR 0016 and ADR 0014 alignment.

For each finding, use `superpowers:receiving-code-review`, reproduce or verify it, add a failing regression when applicable, fix it, rerun the required checks, push, and request re-review at the new exact head.

- [ ] **Step 5: Record exact-head verification and wait for CI**

Run the repository's deterministic and authenticated live smoke commands at the final exact head, update the PR evidence block, and run:

```bash
gh pr checks --watch
```

Expected: required validation succeeds. Do not merge or deploy from the implementation workflow. The deployment agent must merge, wait for the immutable container, update the operator checkout to the corrected deployment script revision, deploy, and verify production before any Scout run.

# Gig Posting Identity Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Let GigFinder distinguish same-company, same-title postings, require explicit user resolution whenever a current Gig is a candidate, and create or update the chosen Gig through `GigDomainService` without losing audited history.

**Architecture:** Extend the existing `NormalizedPosition` as the single posting contract. `GigDomainService` owns candidate discovery, reviewed fingerprints, and applying a posting; `ScoutPositionService` owns the durable pursue/resolution/document saga; SQLite stores only the exact reviewed intent and terminal result; HTTP and React present the discriminated domain outcomes. Existing Gig rows and `gig_history` remain the current and historical identity stores.

**Tech Stack:** Bun, TypeScript, Zod, SQLite/Drizzle, React, Playwright, dependency-cruiser.

**Spec:** [`docs/superpowers/specs/2026-08-31-gig-posting-identity-resolution-design.md`](../specs/2026-08-31-gig-posting-identity-resolution-design.md)

## Global Constraints

- Apply the repository coding guide and use test-driven development for every behavior change.
- Use only synthetic posting and Gig fixtures. Do not read or mutate private production Visa records.
- Do not add a Gig identity/alias table or a third posting DTO.
- Historical company, requisition ID, and URL values remain reference-only in `gig_history` and never participate in matching.
- Company/title and company/URL candidates are advisory. No candidate is linked automatically, including an exact company/requisition match.
- If candidate discovery returns none, Pursue immediately creates a Gig without a second user action.
- `ScoutPositionService` may coordinate domain services; `src/data/` must not import or invoke service implementations.
- Stable resolution outcomes are values, not exceptions. Throw only for malformed input, persistence failure, or broken invariants.
- Preserve pipeline-owned Gig fields and all existing documents, tasks, people, interactions, and audit history.
- Every task ends with focused verification and a coherent commit. Do not defer test or documentation work to a later pull request.

---

## Task 1: Make `NormalizedPosition` the complete company posting contract

**Files:**

- Modify: `src/core/scout/sourcing/contracts.ts`
- Modify: `src/core/scout/engine/runs.ts`
- Modify: `src/core/scout/engine/scan-company.ts`
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/core/scout/engine/test/scan-company.test.ts`
- Modify: `src/core/scout/engine/test/runs.test.ts`
- Modify: `src/data/test/scout-run-store.test.ts`
- Modify: affected sourcing/runtime/live-verification test fixtures found by `rg 'NormalizedPosition|ScoutCompanyJob|CompanyScanRequest' src`

- [ ] **Step 1: Write RED tests for company propagation**

  Add assertions that a company scan returns every position with the configured display company, and that persisted/recovered `ScoutCompanyJob` values retain it across dispatch and restart.

  ```ts
  expect(result.positions[0]?.company).toBe("Visa");
  expect(store.pendingJobs(10)[0]?.companyName).toBe("Visa");
  ```

- [ ] **Step 2: Run the focused tests and confirm the missing fields fail**

  ```bash
  bun test src/core/scout/engine/test/scan-company.test.ts src/core/scout/engine/test/runs.test.ts src/data/test/scout-run-store.test.ts
  ```

  Expected RED: `company`/`companyName` are absent.

- [ ] **Step 3: Extend the existing contracts, not the persistence model**

  Add the display company to the source request and normalized posting:

  ```ts
  export const companyScanRequestSchema = z.object({
    companyId: z.string().trim().min(1),
    companyName: z.string().trim().min(1),
    // existing fields remain unchanged
  }).strict();

  export interface NormalizedPosition {
    company: string;
    // all existing fields remain unchanged
  }
  ```

  Add `companyName` to `ScoutCompanyJob`. Populate it from `scout_companies.name` in pending/nonterminal job queries, pass it into `scanCompany`, and map source results to `{ ...position, company: input.companyName }`. Do not add `company` to provider template schemas or require providers to repeat company configuration.

- [ ] **Step 4: Update all compile-time fixtures mechanically**

  Supply an explicit synthetic company everywhere a `NormalizedPosition`, `CompanyScanRequest`, or `ScoutCompanyJob` is constructed. Do not use casts or optional fields to bypass the required contract.

- [ ] **Step 5: Verify and commit**

  ```bash
  bun test src/core/scout/engine/test/scan-company.test.ts src/core/scout/engine/test/runs.test.ts src/data/test/scout-run-store.test.ts
  bun run typecheck
  bun run architecture
  git diff --check
  git add src/core/scout src/data/scout-run-store.ts src/data/test
  git commit -m "feat: carry company on normalized Scout positions"
  ```

---

## Task 2: Put posting candidate resolution in `GigDomainService`

**Files:**

- Modify: `src/core/gigs.ts`
- Modify: `src/core/tracker-services.ts`
- Modify: `src/core/test/services.test.ts`

- [ ] **Step 1: Write RED domain tests for every resolution outcome**

  Add synthetic cases covering:

  - no candidates creates immediately;
  - same company/title but different requisition IDs returns advisory candidates and permits confirmed separate creation;
  - exact normalized company/requisition returns `resolution_required`, never an automatic link;
  - missing requisition ID with exact-title and exact-URL evidence;
  - active and closed candidates;
  - multiple exact/advisory candidates with deterministic ordering;
  - case/whitespace normalization with display values preserved;
  - stale fingerprint, stale revision, and unreviewed candidate selection;
  - confirmed existing update preserving pipeline-owned fields and related records; and
  - deliberately reused requisition IDs permitting a confirmed separate Gig.

  ```ts
  expect(service.acceptPosting(context, posting)).toEqual({
    status: "resolution_required",
    fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    candidates: expect.arrayContaining([
      expect.objectContaining({ gigId: existing.id, matchReasons: ["company_requisition"] }),
    ]),
  });
  ```

- [ ] **Step 2: Run the focused service suite and confirm RED**

  ```bash
  bun test src/core/test/services.test.ts
  ```

  Expected RED: resolution types and `acceptPosting` do not exist; company/title still throws `duplicate`.

- [ ] **Step 3: Define the domain result contract in `src/core/gigs.ts`**

  Add strict Zod-backed or equivalent exported contracts:

  ```ts
  export type GigPostingMatchReason =
    | "company_requisition"
    | "company_url"
    | "company_title";

  export interface GigPostingCandidate {
    gigId: string;
    revision: number;
    company: string;
    title: string;
    externalJobId: string | null;
    sourceUrl: string | null;
    location: string | null;
    stage: PipelineStage;
    outcome: Outcome;
    availability: GigAvailability;
    lastActivity: string;
    jobDescription: DocumentSummary | null;
    matchReasons: GigPostingMatchReason[];
  }

  export type PostingResolution =
    | { kind: "create_new"; reviewedFingerprint: string }
    | {
        kind: "use_existing";
        reviewedFingerprint: string;
        gigId: string;
        expectedGigRevision: number;
      };

  export type AcceptPostingResult =
    | { status: "created"; gig: GigRecord }
    | { status: "updated"; gig: GigRecord }
    | { status: "resolution_required"; fingerprint: string; candidates: GigPostingCandidate[] }
    | { status: "resolution_stale"; fingerprint: string; candidates: GigPostingCandidate[] }
    | { status: "resolution_invalid" };

  export interface PostingCandidateResolution {
    fingerprint: string;
    candidates: GigPostingCandidate[];
  }
  ```

- [ ] **Step 4: Implement deterministic candidate selection and fingerprints**

  Add `resolvePosting(posting): PostingCandidateResolution` to
  `GigDomainService`. In that method, normalize only for comparison:

  ```ts
  const identity = (value: string | null | undefined) => value?.trim().toLocaleLowerCase() || null;
  ```

  Query current Gig records only. A candidate must share normalized company and then match nonblank requisition ID, normalized title, or canonical URL. Do not inspect `gig_history`. Sort by requisition, URL, title, active-before-closed, then Gig ID. Hash canonical JSON containing normalized posting identity plus each displayed candidate's ID, revision, reasons, and current job-description version.

- [ ] **Step 5: Implement `acceptPosting` without duplicating Gig persistence**

  Extract the existing audited create body to a private `persistNew` helper. Keep `createNew`'s existing structured duplicate behavior for general agent/CLI callers. `acceptPosting` must:

  1. call `resolvePosting` to calculate candidates/fingerprint;
  2. create through `persistNew` when no candidates and no resolution;
  3. return `resolution_required` when candidates exist and no resolution;
  4. return `resolution_stale` when the reviewed fingerprint or selected revision changed;
  5. return `resolution_invalid` when the selected Gig was not in the reviewed candidates;
  6. allow confirmed `create_new` through `persistNew`; and
  7. apply confirmed `use_existing` through the normal audited `update` path.

  Map only posting-owned fields supplied by the posting: title, requisition ID, official URL, display location, and work arrangement. Do not change company, stage, outcome, fit, status summary, last activity, next action, compensation, tags, recruiter fields, or posted date.

  Generate the new Gig ID deterministically from the change ID so retry cannot create another row:

  ```ts
  const gigId = `gig_${createHash("sha256")
    .update(`posting\0${context.changeId}`)
    .digest("hex")
    .slice(0, 32)}`;
  ```

- [ ] **Step 6: Verify and commit**

  ```bash
  bun test src/core/test/services.test.ts
  bun run typecheck
  bun run architecture
  git diff --check
  git add src/core/gigs.ts src/core/tracker-services.ts src/core/test/services.test.ts
  git commit -m "feat: resolve official postings in the Gig domain"
  ```

---

## Task 3: Persist exact reviewed posting resolutions in Scout

**Files:**

- Create: `src/data/migrations/0038_gig_posting_resolution.sql`
- Create: `src/data/migrations/meta/0038_snapshot.json`
- Modify: `src/data/migrations/meta/_journal.json`
- Modify: `src/data/schema.ts`
- Modify: `src/core/scout/engine/positions.ts`
- Modify: `src/data/scout-run-store.ts`
- Modify: `src/data/test/scout-migration.test.ts`
- Modify: `src/data/test/scout-run-store.test.ts`

- [ ] **Step 1: Write migration and store RED tests**

  Cover:

  - exact observation ID and resolution values round-trip;
  - `create_new` and `use_existing` conditional shapes;
  - old completed promotions remain readable;
  - old pending/failed promotions return to resolution instead of replaying a company/title collision;
  - the reviewed `NormalizedPosition` is reconstructed from the exact observation and exact description, not the latest mutable row; and
  - existing Gig/document/task/person/interaction/history records survive migration unchanged.

- [ ] **Step 2: Run focused migration/store tests and confirm RED**

  ```bash
  bun test src/data/test/scout-migration.test.ts src/data/test/scout-run-store.test.ts
  ```

- [ ] **Step 3: Add migration 0038 and Drizzle metadata**

  Add nullable columns to `scout_position_promotions`:

  ```sql
  observation_id TEXT REFERENCES scout_position_observations(id),
  resolution_kind TEXT CHECK (resolution_kind IN ('create_new','use_existing')),
  requested_gig_id TEXT,
  expected_gig_revision INTEGER,
  resolution_fingerprint TEXT
  ```

  Rebuild the SQLite table if needed so checks enforce:

  - `create_new`: fingerprint present, requested Gig/revision null;
  - `use_existing`: fingerprint, requested Gig, and positive expected revision present;
  - completed historical rows remain valid; and
  - new pending rows always carry an observation and coherent resolution.

  Do not add a foreign key from `requested_gig_id`; a confirmed new Gig does not exist when intent is recorded.

- [ ] **Step 4: Replace the loose promotion mutation shape**

  Change `ScoutPromotionWork` to return the exact `NormalizedPosition`, reviewed description/provenance, actor/change IDs, and persisted `PostingResolution`. Remove the duplicated company/title/externalId/location/sourceUrl mutation fields.

  Split store operations so candidate discovery does not record a decision:

  ```ts
  reviewPosting(positionId: string): {
    detail: ScoutPositionDetail;
    observationId: string;
    posting: NormalizedPosition;
    markdown: string;
    sourceDescription: string;
  } | null;

  beginPursue(
    command: ScoutUserDecisionCommand,
    resolution: PostingResolution,
    now: string,
  ): ScoutPromotionWork;
  ```

  `beginPursue` must atomically recheck the reviewed state/description/evaluations, append the decision, and persist promotion intent. `completePromotion` remains the only operation that links the position and removes it from review.

- [ ] **Step 5: Verify and commit**

  ```bash
  bun test src/data/test/scout-migration.test.ts src/data/test/scout-run-store.test.ts
  bun run db:check
  bun run typecheck
  bun run architecture
  git diff --check
  git add src/data src/core/scout/engine/positions.ts
  git commit -m "feat: persist reviewed Gig posting resolutions"
  ```

---

## Task 4: Orchestrate resolution and managed documents in `ScoutPositionService`

**Files:**

- Modify: `src/core/scout/engine/scout-position-service.ts`
- Create: `src/core/scout/engine/test/scout-position-service.test.ts`
- Modify: `src/data/local-application.ts`
- Modify: `src/operations/test/scout-runtime.integration.test.ts`
- Modify: `src/data/test/scout-run-store.test.ts`

- [ ] **Step 1: Write RED core saga tests**

  Test the service with ports/fakes, not SQLite, for:

  - no candidate: decision/intent, Gig creation, document creation, completion;
  - candidate: `resolution_required` with no decision or mutation;
  - confirmed separate and confirmed existing;
  - stale and invalid resolutions leaving the position reviewable;
  - existing Gig with changed Markdown creates one document version;
  - unchanged Markdown creates no version;
  - Gig success followed by document failure then idempotent retry; and
  - retry after a document update conflict reconciles by deterministic change ID.

- [ ] **Step 2: Confirm RED**

  ```bash
  bun test src/core/scout/engine/test/scout-position-service.test.ts
  ```

- [ ] **Step 3: Make `decide` return explicit promotion outcomes**

  Extend the pursue command with optional `PostingResolution`. For non-pursue actions, keep the current decision behavior. For Pursue:

  1. load and validate the exact reviewed posting;
  2. call the read-only `gigs.resolvePosting`;
  3. if candidates exist and no resolution was submitted, return them without calling `store.decide`/`beginPursue`;
  4. if no candidates exist, persist a `create_new` resolution using the empty candidate-set fingerprint, then call `acceptPosting` with that persisted resolution;
  5. when the user supplies a resolution, persist the reviewed decision/intent and call `acceptPosting` with it;
  6. coordinate the resulting Gig's job description through `ManagedDocumentService`; and
  7. complete Scout only after Gig and document state verify.

  The service result should retain the Gig-domain discriminator:

  ```ts
  type ScoutPursueResult =
    | { status: "created" | "updated"; position: ScoutPositionDetail | null }
    | { status: "resolution_required"; fingerprint: string; candidates: GigPostingCandidate[] }
    | { status: "resolution_stale"; fingerprint: string; candidates: GigPostingCandidate[]; position: ScoutPositionDetail }
    | { status: "resolution_invalid"; position: ScoutPositionDetail };
  ```

  A post-intent stale or invalid result releases the attempt and returns the
  exact refreshed review detail, including its incremented state revision, so
  the displayed replacement choice is directly submit-able.

- [ ] **Step 4: Reuse the managed-document service update semantics**

  Look up the selected Gig's current `job_description` document from the domain result. Create when absent. When present, call `ManagedDocumentService.get` and compare exact normalized Markdown. Call `update` with expected version only when content differs. Use deterministic `:document` change IDs and reconcile retries with `createdByChange`/`versionByChange`.

  The generated title convention applies only when Scout creates a missing
  document. Existing managed-document titles are user-authored metadata and
  remain unchanged; verify their exact identity, Gig ownership, type, media
  type, and content without requiring a rename. When existing normalized
  Markdown is unchanged, create no version and accept the existing version's
  historical source description and provenance. The new reviewed provenance
  remains in the Scout promotion audit; do not fabricate a provenance-only
  managed-document version. Changed Markdown still requires exact reviewed
  provenance on its new immutable version.

- [ ] **Step 5: Wire the composition root and update fakes**

  Inject `GigDomainService` with `resolvePosting`/`acceptPosting` and `ManagedDocumentService` with `get/create/update/createdByChange/versionByChange` in `src/data/local-application.ts`. Update runtime/store fakes without weakening production types.

- [ ] **Step 6: Verify and commit**

  ```bash
  bun test src/core/scout/engine/test/scout-position-service.test.ts src/data/test/scout-run-store.test.ts src/operations/test/scout-runtime.integration.test.ts
  bun run typecheck
  bun run architecture
  git diff --check
  git add src/core/scout src/data/local-application.ts src/data/test src/operations/test
  git commit -m "feat: orchestrate reviewed posting promotion"
  ```

---

## Task 5: Add the explicit comparison flow to the existing review drawer

**Files:**

- Modify: `src/web/request-handler.ts`
- Modify: `src/web/test/request-handler.test.ts`
- Modify: `src/web/client/ScoutPositionReview.tsx`
- Modify: `src/web/client/styles.css`
- Modify: `src/web/test/client/scout-position-review.test.ts`
- Modify: `src/web/e2e/dev.ts`
- Modify: `src/web/e2e/gig-scout.e2e.ts`

- [ ] **Step 1: Write RED HTTP, component, and browser tests**

  Cover:

  - no candidates: one Pursue click succeeds and removes the row;
  - candidates: drawer remains open and displays all comparison fields;
  - links open both the Scout and existing Gig descriptions in `/documents/:reference/versions/:version`;
  - user can choose Create separate Gig or one existing Gig;
  - no note is required for the resolution;
  - stale evidence refreshes candidates in place;
  - successful resolution removes only the chosen row and preserves scroll/filter state; and
  - failures retain the row, choice, and actionable error.

- [ ] **Step 2: Run focused tests and confirm RED**

  ```bash
  bun test src/web/test/request-handler.test.ts src/web/test/client/scout-position-review.test.ts
  bun run test:e2e -- --grep "posting identity resolution"
  ```

- [ ] **Step 3: Return stable outcomes from the existing endpoint**

  Extend `POST /api/gig-scout/positions/:id/decision` to accept only the optional reviewed resolution fields. Pass trusted actor data server-side. Return HTTP 200 for `created`, `updated`, `resolution_required`, `resolution_stale`, and `resolution_invalid`; retain 409 for a stale Scout review revision and 422 for malformed commands.

- [ ] **Step 4: Implement comparison inside `ScoutPositionReview`**

  Keep the current side-panel design. After Pursue returns candidates, replace the normal action region with:

  - the reviewed posting;
  - candidate company/title, requisition ID, official URL, location, stage/outcome, availability, last activity;
  - GigFinder document links for both descriptions;
  - one explicit Use this Gig action per candidate; and
  - one Create separate Gig action.

  Do not add a modal, popup, note requirement, match confidence, or automatic selection. Preserve the user's list position and close the agent panel using the existing row-open behavior.

- [ ] **Step 5: Add the synthetic Visa-equivalent E2E**

  Seed one company with two same-title postings and distinct requisition IDs. Verify the existing Gig appears only as advisory evidence, confirmed separate creation produces a second Gig, and confirming an exact requisition candidate updates posting-owned fields and creates exactly one immutable description version.

- [ ] **Step 6: Verify and commit**

  ```bash
  bun test src/web/test/request-handler.test.ts src/web/test/client/scout-position-review.test.ts
  bun run test:e2e -- --grep "posting identity resolution"
  bun run typecheck
  bun run build
  git diff --check
  git add src/web
  git commit -m "feat: resolve Gig identity from position review"
  ```

---

## Task 6: Align product and architecture documentation

**Files:**

- Modify: `docs/product/001-opportunity-pipeline.md`
- Modify: `docs/product/006-gig-scout.md`
- Create: `docs/architecture/decisions/0017-own-gig-posting-identity-resolution.md`
- Modify: `docs/architecture/overview.md`

- [ ] **Step 1: Update FRR-001**

  Define current Gig posting identity as normalized company plus current nonblank requisition ID. State that prior identity values remain revision-history references only, same-title Gigs are allowed after explicit resolution, and applying a posting is owned by `GigDomainService`.

- [ ] **Step 2: Update FRR-006**

  Document one-click creation when no candidates exist, explicit comparison after Pursue when candidates exist, candidate display fields/document links, stale refresh, confirmed existing updates, immutable description versions, and unchanged review-list behavior.

- [ ] **Step 3: Add short ADR 0017**

  Record only the architectural decision: one current posting identity per Gig, old values retained in `gig_history` for reference but excluded from matching, posting acceptance owned by the Gig domain, and Scout responsible for reviewed workflow orchestration. Do not add a new architecture diagram.

- [ ] **Step 4: Link the ADR from the overview**

  Add one concise decision-list entry. Do not expand the overview with implementation detail.

- [ ] **Step 5: Review and commit**

  ```bash
  rg -n "company.*title|duplicate|requisition|Pursue|promotion" docs/product docs/architecture
  git diff --check
  git add docs/product docs/architecture
  git commit -m "docs: define reviewed Gig posting identity"
  ```

---

## Task 7: Run complete verification and prepare the pull request

**Files:**

- Modify only files required to fix failures caused by this plan.
- Do not commit generated reports, private fixtures, or ignored `tmp/` content.

- [ ] **Step 1: Run the complete required matrix**

  ```bash
  bun run db:check
  bun run check
  bun run build
  bun run test:e2e
  ```

- [ ] **Step 2: Run privacy and scope checks**

  ```bash
  git diff --check
  git status --short
  rg -n "Visa|REF078975W|REF084743W" src docs --glob '!docs/superpowers/**'
  rg -n "gig_history" src/core/tracker-services.ts src/data --glob '*.ts'
  ```

  The first search must show no private production fixture. Inspect the second to ensure candidate matching never reads history.

- [ ] **Step 3: Self-review the full diff against the spec**

  Confirm every verification bullet in the design has an automated test; no `TODO`, `TBD`, placeholder, parallel posting DTO, data-layer service import, historical matching, or silent candidate link remains.

  ```bash
  rg -n "TODO|TBD|placeholder|JobPosting" src docs/superpowers
  bun run architecture
  ```

- [ ] **Step 4: Commit any coherent verification fixes**

  ```bash
  git add -u
  git commit -m "test: verify Gig posting identity resolution"
  ```

- [ ] **Step 5: Push and open the PR**

  ```bash
  git push -u origin issue-146-gig-identity
  gh pr create --base main --head issue-146-gig-identity --title "Resolve Gig identity when pursuing Scout positions" --body $'Closes #146\n\nImplements reviewed Gig posting identity resolution from the approved Superpowers spec and plan.\n\nVerification evidence will be added before final review.'
  ```

  The PR body must include `Closes #146`, the synthetic verification scope, migration 0038, architecture/documentation changes, and the complete command evidence. Then follow the repository's final Superpowers review, release-verifier, change-overview, required-check, and deployer handoffs.

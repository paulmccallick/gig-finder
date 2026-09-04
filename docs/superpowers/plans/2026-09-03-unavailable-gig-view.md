# Unavailable Gig View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated, filterable Unavailable Gig view that removes unavailable postings from Active while preserving pipeline state and explicit Scout ownership.

**Architecture:** Extend the pure board-domain view contract to own Active, Unavailable, and Archive membership plus unavailable ordering and timestamp presentation. Update the existing React Gig board to consume those functions, render a single chronological Unavailable list with existing controls and drawer behavior, and verify the integration with synthetic Playwright fixtures. No persistence or API contract changes are required.

**Tech Stack:** TypeScript, React 19, Bun test, Playwright, CSS, SQLite-backed E2E fixtures.

**Spec:** `docs/superpowers/specs/2026-09-02-unavailable-gig-view-design.md`

## Global Constraints

- `Active` contains non-closed Gigs whose availability is `unknown` or `available`.
- `Unavailable` contains non-closed Gigs whose availability is `unavailable`.
- `Archive` contains closed Gigs regardless of availability; pipeline closure takes precedence.
- Availability remains Scout-owned. Do not add a manual availability mutation or a new agent tool.
- Preserve Gig identity, stage, outcome, next action, history, documents, people, tasks, interactions, and Scout linkage.
- Use existing `availability` and `availabilityUpdatedAt`; add no schema, migration, API, or history-query path.
- Show and sort the Unavailable view from `availabilityUpdatedAt`, newest first. Never invent a missing date.
- Retain search, stage, fit, and overdue filters in Unavailable.
- Show the unavailable count only on the tab, not in the dashboard metrics.
- Use synthetic fixtures only. Use Bun commands and never `bunx`.
- Follow strict RED-GREEN-REFACTOR for every production behavior change.

---

### Task 1: Define board membership, unavailable ordering, and timestamp presentation

**Files:**
- Modify: `src/web/client/domain/board.ts`
- Test: `src/web/test/client/domain/board.test.ts`

**Interfaces:**
- Consumes: existing `GigSummary`, `BoardFilters`, `compareGigs`, and Pacific-time presentation convention.
- Produces: `BoardMode = "active" | "unavailable" | "archive"`; `compareUnavailableGigs(a, b): number`; `formatUnavailableSince(value): string | null`; availability-aware `filterGigs` behavior consumed by Task 2.

- [ ] **Step 1: Add availability defaults and write failing membership tests**

Update the `gig` test factory so every test has explicit default availability:

```ts
availability: "unknown",
availabilityUpdatedAt: null,
```

Replace the two-mode separation test with a three-mode test containing unknown, available, unavailable, and closed-unavailable records. Assert exact IDs:

```ts
const gigs = [
  gig({ id: "unknown" }),
  gig({ id: "available", availability: "available" }),
  gig({ id: "unavailable", availability: "unavailable", availabilityUpdatedAt: "2026-07-14T16:00:00.000Z" }),
  gig({ id: "closed-unavailable", stage: "closed", outcome: "role_pulled", nextAction: null, availability: "unavailable", availabilityUpdatedAt: "2026-07-13T16:00:00.000Z" }),
];
expect(filterGigs(gigs, "active", emptyFilters).map(item => item.id)).toEqual(["unknown", "available"]);
expect(filterGigs(gigs, "unavailable", emptyFilters).map(item => item.id)).toEqual(["unavailable"]);
expect(filterGigs(gigs, "archive", emptyFilters).map(item => item.id)).toEqual(["closed-unavailable"]);
```

Define a local `emptyFilters` test constant matching the production shape instead of repeating literals.

- [ ] **Step 2: Run the membership test and verify RED**

Run:

```bash
bun test src/web/test/client/domain/board.test.ts
```

Expected: TypeScript/test failure because `"unavailable"` is not a valid `BoardMode`, or an assertion failure because unavailable records still remain Active. Confirm the failure is caused by missing three-view membership behavior.

- [ ] **Step 3: Implement minimal three-view membership**

In `src/web/client/domain/board.ts`, extend the mode type and centralize membership inside `filterGigs`:

```ts
export type BoardMode = "active" | "unavailable" | "archive";

function belongsToMode(gig: GigSummary, mode: BoardMode): boolean {
  if (mode === "archive") return gig.stage === "closed";
  if (gig.stage === "closed") return false;
  return mode === "unavailable"
    ? gig.availability === "unavailable"
    : gig.availability !== "unavailable";
}
```

Replace the current stage-only mode condition with:

```ts
if (!belongsToMode(gig, mode)) return false;
```

Treat an omitted availability value as unknown, preserving compatibility with existing summaries.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `bun test src/web/test/client/domain/board.test.ts` and require every board-domain test to pass with no warnings.

- [ ] **Step 5: Write failing tests for unavailable filters and ordering**

Add one test proving search, stage, fit, and overdue compose inside `unavailable`. Include at least two unavailable records and one available record; assert only the unavailable record matching all four filters remains.

Add an ordering test with two valid timestamps and one missing timestamp:

```ts
const newest = gig({ id: "newest", availability: "unavailable", availabilityUpdatedAt: "2026-07-15T16:00:00.000Z" });
const older = gig({ id: "older", availability: "unavailable", availabilityUpdatedAt: "2026-07-14T16:00:00.000Z" });
const missing = gig({ id: "missing", availability: "unavailable", availabilityUpdatedAt: null });
expect([older, missing, newest].sort(compareUnavailableGigs).map(item => item.id)).toEqual(["newest", "older", "missing"]);
```

Add timestamp presentation assertions:

```ts
expect(formatUnavailableSince("2026-07-15T16:00:00.000Z")).toBe("Jul 15, 2026");
expect(formatUnavailableSince(null)).toBeNull();
expect(formatUnavailableSince(undefined)).toBeNull();
expect(formatUnavailableSince("not-an-instant")).toBeNull();
```

- [ ] **Step 6: Run the focused test and verify RED**

Run `bun test src/web/test/client/domain/board.test.ts`.

Expected: import/type failures for `compareUnavailableGigs` and `formatUnavailableSince`. Confirm existing membership assertions remain green.

- [ ] **Step 7: Implement minimal unavailable ordering and formatting**

Export these functions from `board.ts`:

```ts
export function compareUnavailableGigs(a: GigSummary, b: GigSummary): number {
  const timestampDifference = (b.availabilityUpdatedAt ?? "")
    .localeCompare(a.availabilityUpdatedAt ?? "");
  return timestampDifference || compareGigs(a, b);
}

export function formatUnavailableSince(value: string | null | undefined): string | null {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(instant);
}
```

Keep missing timestamps after real timestamps and use existing `compareGigs` as the deterministic tie-breaker.

- [ ] **Step 8: Run focused tests, refactor, and commit**

Run:

```bash
bun test src/web/test/client/domain/board.test.ts
bun run test
git diff --check
```

Require the focused tests and complete test suite to pass and output to be clean. Self-review the two-file diff, then commit:

```bash
git add src/web/client/domain/board.ts src/web/test/client/domain/board.test.ts
git commit -m "feat: classify unavailable Gigs"
```

---

### Task 2: Render and verify the dedicated Unavailable view

**Files:**
- Modify: `src/web/client/App.tsx`
- Modify: `src/web/client/styles.css`
- Modify: `src/web/e2e/dev.ts`
- Modify: `src/web/e2e/gig-board.e2e.ts`
- Modify: `docs/product/006-gig-scout.md`

**Interfaces:**
- Consumes: Task 1's `BoardMode`, `filterGigs`, `compareUnavailableGigs`, and `formatUnavailableSince` exports.
- Produces: an accessible Unavailable tab with a count; a single chronological `.unavailable-list`; retained controls; cards and drawer that distinguish availability from pipeline stage; authoritative-load behavior covered by Playwright.

- [ ] **Step 1: Add synthetic unavailable fixtures**

In `src/web/e2e/dev.ts`, add two non-closed synthetic Gigs with different stages, fits, next-action dates, and explicit timestamps. Use stable IDs and values:

```ts
{
  id: "gig-unavailable-newest", company: "Unavailable New Systems",
  title: "Director of New Signals", externalJobId: "UNAVAILABLE-NEW",
  stage: "screening", outcome: "pending",
  statusSummary: "Official posting no longer listed", lastActivity: "2026-08-28",
  nextActionDescription: "Decide whether to archive", nextActionDue: "2026-08-30",
  fitRating: "strong", fitSummary: "Synthetic unavailable fixture",
  sourceUrl: "https://careers.example.test/jobs/unavailable-new",
  availability: "unavailable", availabilityUpdatedAt: "2026-08-29T18:00:00.000Z",
  // Set every remaining GigData field explicitly using null or "[]" as appropriate.
}
```

The second record uses ID `gig-unavailable-older`, company `Unavailable Older Works`, title `VP of Earlier Signals`, stage `identified`, fit `good`, and `availabilityUpdatedAt: "2026-08-27T18:00:00.000Z"`. Keep all fixture data synthetic.

- [ ] **Step 2: Write the failing browser regression**

Add a focused test named `unavailable view is chronological, filterable, and distinct from archive` to `src/web/e2e/gig-board.e2e.ts`. It must:

```ts
await page.goto("/");
await expect(page.getByRole("tab", { name: /Unavailable 2/ })).toBeVisible();
await expect(page.locator(".record-card", { hasText: "Unavailable New Systems" })).toHaveCount(0);
await page.getByRole("tab", { name: /Unavailable 2/ }).click();
await expect(page.locator(".unavailable-list .record-card")).toHaveCount(2);
expect(await page.locator(".unavailable-list .card-company").allTextContents())
  .toEqual(["Unavailable New Systems", "Unavailable Older Works"]);
await expect(page.locator(".record-card").first()).toContainText("Screening");
await expect(page.locator(".record-card").first()).toContainText("Unavailable since Aug 29, 2026");
```

Then select stage `Identified`, assert only `Unavailable Older Works` remains, exercise search, fit, and Overdue only without removing those controls from the DOM, clear the filters, open the first card, and assert the drawer separately exposes `Availability: Unavailable` and `Pipeline stage: Screening`. Switch to Archive and assert neither unavailable fixture is present.

For authoritative restoration, route only `/api/gigs`, obtain the original real response once, and fulfill subsequent Gig loads from a cloned array in which `gig-unavailable-newest` changes from `unavailable` to `available` without changing its ID or stage. Reload the page, then assert that exact company is absent from Unavailable and present in Active under Screening. Do not create a client-only availability mutation.

- [ ] **Step 3: Run the focused E2E test and verify RED**

Run:

```bash
bun run test:e2e -- --grep "unavailable view is chronological"
```

Expected: failure because the Unavailable tab/list and its presentation do not exist. Confirm the fixture is returned by `/api/gigs` so the failure proves missing UI behavior rather than fixture setup.

- [ ] **Step 4: Implement Unavailable tab membership and counts**

In `App.tsx`, import `compareUnavailableGigs` and `formatUnavailableSince`. Calculate counts through the domain selector so metrics and tabs do not diverge:

```ts
const activeCount = filterGigs(gigs, "active", emptyFilters, today).length;
const unavailableCount = filterGigs(gigs, "unavailable", emptyFilters, today).length;
const archiveCount = filterGigs(gigs, "archive", emptyFilters, today).length;
```

Keep the four existing pipeline metrics and add only this tab:

```tsx
<button role="tab" aria-selected={mode === "unavailable"} onClick={() => switchMode("unavailable")}>
  Unavailable <span>{unavailableCount}</span>
</button>
```

Show the Stage select and Overdue checkbox when `mode !== "archive"`. Preserve all filters when switching modes; clear only `stage` and `overdueOnly` if the next mode is Archive, where those controls are unavailable. Do not hide any of the four filters in Unavailable.

- [ ] **Step 5: Implement the chronological list and explicit availability presentation**

Keep the existing grouped kanban rendering for Active and Archive. For Unavailable, render:

```tsx
<section className="unavailable-list" aria-label="unavailable gig list">
  {visibleGigs
    .slice()
    .sort(compareUnavailableGigs)
    .map(gig => (
      <GigCard
        gig={gig}
        unavailable
        onSelect={gigId => setSelectedGig(gigs.find(candidate => candidate.id === gigId) ?? null)}
        key={gig.id}
      />
    ))}
</section>
```

Extend `GigCard` with `unavailable?: boolean`. When true, show `stageLabels[gig.stage]` and either `Unavailable since ${formatUnavailableSince(gig.availabilityUpdatedAt)}` or the explicit fallback `Unavailable — date not recorded`. Do not show a fabricated date.

In `GigDrawer`, add clearly named details:

```tsx
<DetailItem label="Pipeline stage">{stageLabels[gig.stage]}</DetailItem>
<DetailItem label="Availability">
  {gig.availability === "unavailable" ? "Unavailable" : gig.availability === "available" ? "Available" : "Unknown"}
</DetailItem>
{gig.availability === "unavailable" && (
  <DetailItem label="Unavailable since">
    {formatUnavailableSince(gig.availabilityUpdatedAt) ?? "Date not recorded"}
  </DetailItem>
)}
```

Avoid duplicating the pipeline-stage value elsewhere in the drawer if the existing stage badge already provides the same accessible information; choose one clearly labeled presentation and make the browser assertion match it.

- [ ] **Step 6: Add focused responsive styling**

In `styles.css`, add a constrained single-column list rather than another kanban lane:

```css
.unavailable-list {
  display: grid;
  gap: 10px;
  width: min(100%, 760px);
  padding: 16px 0 30px;
  min-height: 410px;
}
.unavailable-list .record-card { min-height: 0; }
.availability-line { margin-top: 10px; color: var(--red); font-size: 10px; }
.availability-stage { color: var(--muted); }
```

Use existing responsive control rules. Verify at 390px that the three tabs, all four filters, list card, and drawer remain operable without introducing a fixed list width.

- [ ] **Step 7: Update the product contract**

In `docs/product/006-gig-scout.md`, add these explicit acceptance rules beside the existing Gig availability scenarios:

```md
- **Given** a non-closed Gig is unavailable, **When** the Gig board loads, **Then** it appears only in the chronological Unavailable view and retains its pipeline stage, filters, related records, and explicit availability timestamp.
- **Given** an unavailable Gig later becomes available through trustworthy Scout evidence, **When** the dashboard refreshes, **Then** the same Gig returns to Active in its retained pipeline stage.
- **Given** an unavailable Gig is explicitly closed with a non-pending outcome, **When** the dashboard refreshes, **Then** it appears in Archive rather than Unavailable.
```

Update the UX/UI impact paragraph to name the dedicated Unavailable view. Do not change Scout trust, matching, or persistence requirements.

- [ ] **Step 8: Run the focused browser test and verify GREEN**

Run:

```bash
bun run test:e2e -- --grep "unavailable view is chronological"
```

Require the test to pass under the repository's normal Playwright timeout, with no retries, timeout increases, arbitrary sleeps, page errors, or console errors.

- [ ] **Step 9: Refactor and run focused regression tests**

Remove duplicated selection/count/presentation logic exposed by GREEN while keeping board-domain functions pure. Run:

```bash
bun test src/web/test/client/domain/board.test.ts
bun run test:e2e -- --grep "active board|unavailable view|mobile board"
```

Require the focused unit suite and existing/new board scenarios to pass. Confirm Active excludes unavailable fixtures, Archive remains closed-only, and mobile controls fit without changing global timeouts.

- [ ] **Step 10: Run all completion gates**

Run each command freshly and record its exit status:

```bash
bun run check
bun run build
bun run test:e2e
git diff --check
```

Do not substitute `bunx`, omit a gate, or rely on earlier task evidence. Fix every failure before proceeding.

- [ ] **Step 11: Self-review and commit**

Review the complete Task 2 diff against the approved spec. Confirm there is no migration, new agent tool, manual availability action, summary metric tile, real personal data, or unrelated refactor. Commit only the listed files:

```bash
git add src/web/client/App.tsx src/web/client/styles.css src/web/e2e/dev.ts src/web/e2e/gig-board.e2e.ts docs/product/006-gig-scout.md
git diff --cached --check
git commit -m "feat: add unavailable Gig view"
```

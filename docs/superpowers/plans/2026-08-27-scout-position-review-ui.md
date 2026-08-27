# Scout Position Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the operations-oriented Scout Positions table with a Tasks-style review ledger and drawer, while reusing the existing decision APIs and document viewer.

**Architecture:** Keep the change inside `src/web/`: extract focused review components from `GigScoutPage.tsx`, coordinate Agent-panel exclusivity from the existing `App` composition point, and adapt the existing position-detail response to a reusable document-view shell. Existing core contracts, HTTP APIs, persistence, Scout processing, and managed-document lifecycle remain unchanged.

**Tech Stack:** Bun, TypeScript, React 19, Vite, Playwright, React Markdown, existing GigFinder CSS design tokens

**Spec:** `docs/superpowers/specs/2026-08-27-scout-position-review-ui-design.md`

## Global Constraints

- Apply `.agents/skills/coding-guide/SKILL.md` throughout implementation and review.
- Reuse the Tasks ledger, `record-drawer`, dashboard controls, typography, and responsive conventions; do not introduce a separate Scout visual language.
- Do not add or change core, data, operations, schema, migration, or HTTP API contracts.
- Do not display relevance confidence or relevance reason.
- Do not create managed documents for unpromoted Scout descriptions.
- Use synthetic fixtures only; never place production position or description content in source control.
- Preserve Pursue, Mark irrelevant, Defer, stale-revision handling, and promotion retry through the existing endpoints.
- Update `docs/product/006-gig-scout.md`; do not add an ADR or change architecture documentation.
- Run `bun run check`, `bun run build`, and `bun run test:e2e` before completion.

---

## File Structure

- `src/web/client/ScoutPositionReview.tsx` — position list/detail types, page loading, Tasks-style ledger, review drawer, decision state, authoritative refresh, scroll preservation, and description expansion.
- `src/web/client/DocumentViewShell.tsx` — reusable document-view frame, Back behavior, Markdown/plain-text rendering, and bounded loading/error presentation.
- `src/web/client/DocumentViewer.tsx` — managed-document adapter plus Scout-description route adapter over the shared shell.
- `src/web/client/GigScoutPage.tsx` — Run history and top-level Gig Scout view selection; delegates Positions to `ScoutPositionReview`.
- `src/web/client/App.tsx` — owns Agent workspace state and closes it before a position drawer opens; honors the Scout fallback query parameter.
- `src/web/client/main.tsx` — recognizes managed-document and Scout-description viewer routes.
- `src/web/client/styles.css` — review-ledger, drawer, description, and document Back-control styling using existing tokens.
- `src/web/test/client/document-viewer.test.ts` — route parsing and deterministic Back behavior.
- `src/web/test/client/scout-position-review.test.ts` — pagination reconciliation and route/helper contracts.
- `src/web/e2e/gig-scout.e2e.ts` — review ledger/drawer, Agent exclusivity, decisions, scroll continuity, responsive containment, and description viewing.
- `docs/product/006-gig-scout.md` — review-first Positions behavior.

---

## Execution Gate

Before Task 1 changes application code, move issue #142 from Grooming to
Development and add links to the committed spec and plan without rewriting the
approved requirements. Keep it in Development through implementation, review,
CI, deployment, and production verification.

---

### Task 1: Reusable Document View and Navigation Escape

**Files:**
- Create: `src/web/client/DocumentViewShell.tsx`
- Modify: `src/web/client/DocumentViewer.tsx`
- Modify: `src/web/client/main.tsx`
- Modify: `src/web/client/App.tsx`
- Modify: `src/web/client/styles.css`
- Test: `src/web/test/client/document-viewer.test.ts`

**Interfaces:**
- Produces: `DocumentViewShell(props: DocumentViewShellProps): JSX.Element`
- Produces: `leaveDocumentView(navigation: DocumentNavigation, fallbackHref: string): "closed" | "history" | "fallback"`
- Produces: `parseScoutDescriptionViewerPath(pathname: string): { positionId: string } | null`
- Produces: `initialWorkspaceView(search: string): WorkspaceView`
- Consumes: existing `MarkdownRenderer`, managed-document API, and `/api/gig-scout/positions/:id` detail API

- [ ] **Step 1: Add failing route and Back-navigation tests**

Extend `src/web/test/client/document-viewer.test.ts` with concrete tests:

```ts
import {
  leaveDocumentView,
  parseScoutDescriptionViewerPath,
} from "../../client/DocumentViewShell";
import { initialWorkspaceView } from "../../client/App";

test("Scout description viewer accepts one opaque position id", () => {
  expect(parseScoutDescriptionViewerPath(
    "/gig-scout/positions/spos_0123456789abcdef/description",
  )).toEqual({ positionId: "spos_0123456789abcdef" });
  expect(parseScoutDescriptionViewerPath(
    "/gig-scout/positions/..%2Fprivate/description",
  )).toBeNull();
});

test("document Back closes an opener-created context", () => {
  const events: string[] = [];
  const navigation = {
    hasOpenOpener: true,
    historyLength: 1,
    close: () => events.push("close"),
    back: () => events.push("back"),
    assign: (href: string) => events.push(`assign:${href}`),
  };
  expect(leaveDocumentView(navigation, "/?workspace=scout")).toBe("closed");
  expect(events).toEqual(["close"]);
});

test("document Back uses history and then the Scout fallback", () => {
  const historyEvents: string[] = [];
  expect(leaveDocumentView({
    hasOpenOpener: false,
    historyLength: 2,
    close: () => historyEvents.push("close"),
    back: () => historyEvents.push("back"),
    assign: href => historyEvents.push(`assign:${href}`),
  }, "/?workspace=scout")).toBe("history");
  expect(historyEvents).toEqual(["back"]);

  const fallbackEvents: string[] = [];
  expect(leaveDocumentView({
    hasOpenOpener: false,
    historyLength: 1,
    close: () => fallbackEvents.push("close"),
    back: () => fallbackEvents.push("back"),
    assign: href => fallbackEvents.push(`assign:${href}`),
  }, "/?workspace=scout")).toBe("fallback");
  expect(fallbackEvents).toEqual(["assign:/?workspace=scout"]);
  expect(initialWorkspaceView("?workspace=scout")).toBe("scout");
});
```

- [ ] **Step 2: Run the focused tests and verify the RED state**

Run:

```bash
bun test src/web/test/client/document-viewer.test.ts
```

Expected: FAIL because `DocumentViewShell`, `parseScoutDescriptionViewerPath`, `leaveDocumentView`, and `initialWorkspaceView` do not exist.

- [ ] **Step 3: Implement the reusable shell and deterministic Back helper**

Create `src/web/client/DocumentViewShell.tsx` with these public contracts:

```tsx
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface DocumentNavigation {
  hasOpenOpener: boolean;
  historyLength: number;
  close(): void;
  back(): void;
  assign(href: string): void;
}

export interface DocumentViewShellProps {
  eyebrow: string;
  title: string;
  content: string | null;
  mediaType: "text/markdown" | "text/plain";
  loading: boolean;
  failure: string | null;
  downloadHref?: string;
  backFallbackHref: string;
}

export function leaveDocumentView(
  navigation: DocumentNavigation,
  fallbackHref: string,
): "closed" | "history" | "fallback" {
  if (navigation.hasOpenOpener) {
    navigation.close();
    return "closed";
  }
  if (navigation.historyLength > 1) {
    navigation.back();
    return "history";
  }
  navigation.assign(fallbackHref);
  return "fallback";
}
```

Render a header Back button before the title. Adapt `window.opener`,
`window.history`, `window.close`, and `window.location.assign` only inside the
button handler. Render Markdown with `MarkdownRenderer`, plain text with a
wrapping `<pre>`, and retain the existing loading/error copy.

- [ ] **Step 4: Adapt managed and Scout descriptions to the shared shell**

In `DocumentViewer.tsx`:

- retain `parseDocumentViewerPath` and managed response validation;
- add a strict path parser for
  `/gig-scout/positions/:positionId/description`, accepting only
  `spos_[0-9a-f]+` after `decodeURIComponent`;
- add `ScoutDescriptionViewer` that fetches the existing detail endpoint;
- validate `id`, non-empty `title`, `descriptionMarkdown`, and source metadata;
- pass stored Markdown to `DocumentViewShell` without creating a managed
  document; and
- give both viewers `backFallbackHref="/?workspace=scout"` only for Scout and
  `backFallbackHref="/"` for ordinary managed documents.

The Scout adapter should use this response shape:

```ts
interface ScoutDescriptionViewData {
  id: string;
  title: string;
  company: string;
  descriptionMarkdown: string | null;
  descriptionSourceUrl: string | null;
  descriptionRetrievedAt: string | null;
}
```

In `main.tsx`, render the document viewer route for either `/documents/` or
`/gig-scout/positions/`. In `App.tsx`, export:

```ts
export function initialWorkspaceView(search: string): WorkspaceView {
  return new URLSearchParams(search).get("workspace") === "scout"
    ? "scout"
    : "gigs";
}
```

Initialize `view` lazily from `window.location.search`.

- [ ] **Step 5: Style the shared Back control and bounded content**

Modify `styles.css` so the Back control uses existing `eyebrow`, `icon-button`,
line, panel, and signal tokens. Ensure `.document-viewer-content pre` and Scout
Markdown use:

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
max-width: 100%;
```

Do not add new colors or fonts.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
bun test src/web/test/client/document-viewer.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/web/client/DocumentViewShell.tsx src/web/client/DocumentViewer.tsx src/web/client/main.tsx src/web/client/App.tsx src/web/client/styles.css src/web/test/client/document-viewer.test.ts
git commit -m "feat: reuse document view for Scout descriptions"
```

---

### Task 2: Tasks-Style Position Ledger and Review Drawer

**Files:**
- Create: `src/web/client/ScoutPositionReview.tsx`
- Modify: `src/web/client/GigScoutPage.tsx`
- Modify: `src/web/client/styles.css`
- Test: `src/web/e2e/gig-scout.e2e.ts`

**Interfaces:**
- Consumes: existing `WorkspacePosition` and `WorkspaceDetail` JSON fields
- Consumes: `parseScoutDescriptionViewerPath` route from Task 1
- Produces: `ScoutPositionReview({ onOpenPosition }: { onOpenPosition(): void }): JSX.Element`
- Produces: Tasks-style `.scout-review-ledger`, `.scout-review-row`, and `.scout-review-drawer`

- [ ] **Step 1: Rewrite the existing E2E expectations for the approved ledger**

In the full Scout-run test in `src/web/e2e/gig-scout.e2e.ts`, replace the old
operations-table assertions with:

```ts
const ledger = page.getByRole("region", { name: "Positions for review" });
await expect(ledger.getByText("Head of Orchard Technology")).toBeVisible();
await expect(ledger.getByText("8/10")).toBeVisible();
await expect(ledger.getByText(/synthetic profile aligns/)).toBeVisible();
await expect(ledger.getByText("First seen", { exact: true })).toBeVisible();
await expect(ledger.getByText("Processing", { exact: true })).toHaveCount(0);
await expect(ledger.getByText("Description", { exact: true })).toHaveCount(0);
await expect(ledger.getByText("Observations", { exact: true })).toHaveCount(0);

await ledger.getByRole("button", {
  name: /Head of Orchard Technology/,
}).click();
const drawer = page.getByRole("dialog", { name: "Head of Orchard Technology" });
await expect(drawer).toBeVisible();
await expect(drawer.getByText("8 / 10 match")).toBeVisible();
await expect(drawer.getByText(/synthetic profile aligns/)).toBeVisible();
await expect(drawer.getByLabel("Private note (optional)")).toBeVisible();
await expect(drawer.getByRole("button", { name: "Pursue position" })).toBeVisible();
await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeVisible();
await expect(drawer.getByRole("button", { name: "Defer review" })).toBeVisible();
```

- [ ] **Step 2: Run the focused browser test and verify the RED state**

Run:

```bash
bun run test:e2e -- --grep "discovers and processes positions"
```

Expected: FAIL because the current Positions page renders the operations table
and replaces the page with inline detail.

- [ ] **Step 3: Extract position review types and data loading**

Create `ScoutPositionReview.tsx` and move `WorkspacePosition`,
`WorkspaceDetail`, list loading, detail loading, filters, sorting, pagination,
and current error state out of `GigScoutPage.tsx`.

Export only the component. Keep the JSON types private and retain all existing
fields because the drawer diagnostics still need them. Accept:

```ts
export interface ScoutPositionReviewProps {
  onOpenPosition(): void;
}

export function ScoutPositionReview({
  onOpenPosition,
}: ScoutPositionReviewProps) {
  // existing list and detail reads
}
```

Before setting the selected id, call `onOpenPosition()`.

- [ ] **Step 4: Implement the Tasks-style ledger**

Use one semantic `<button>` per row, following `TaskBoard` rather than nesting
buttons or links. Columns are exactly:

1. score rendered as `8/10` or `—`;
2. title plus one-line score explanation;
3. company plus location;
4. first-seen date.

Use a region named `Positions for review`. Keep operations fields out of the
row. Keep existing filters, sorts, counts, and pagination above/below the
ledger, restyled with existing `controls`, `search-control`, `select-control`,
and `clear-button` classes.

- [ ] **Step 5: Implement the established record drawer**

Render the detail beside the still-mounted ledger with:

```tsx
<div className="drawer-layer">
  <button className="drawer-scrim" aria-label="Close position review" />
  <aside
    className="record-drawer scout-review-drawer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="scout-review-drawer-title"
  >
    {/* drawer-header and drawer-body */}
  </aside>
</div>
```

Match `TaskDrawer` focus-on-open, Escape, scrim, and close-button behavior.
Show the score chip, full score explanation, optional note textarea, decision
section, bounded description, expandable description button, an
`Open in document view` link targeting
`/gig-scout/positions/${encodeURIComponent(detail.id)}/description`, and one
collapsed diagnostics `<details>` section.

The open-document link must use a same-origin new browsing context and preserve
the Positions page. Use an explicit accessible label containing the position
title.

- [ ] **Step 6: Implement review-specific styling from existing patterns**

Add `.scout-review-ledger` and `.scout-review-row` by mirroring the structural
properties of `.task-ledger` and `.task-row`. Add only layout selectors needed
for the four columns, score chip, drawer decisions, note, description height,
expanded description, and diagnostics.

Use existing variables (`--ink`, `--muted`, `--dim`, `--signal`, `--amber`,
`--red`, `--line`, `--line-bright`, `--panel`) and existing fonts. Use:

```css
.scout-review-explanation {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scout-review-description {
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.scout-review-description.is-expanded { max-height: none; }
```

- [ ] **Step 7: Delegate Positions rendering from GigScoutPage**

Change the top-level component contract to:

```tsx
export function GigScoutPage({
  onOpenPosition,
}: {
  onOpenPosition(): void;
}) {
  // existing Positions / Run history tabs
}
```

Render `<ScoutPositionReview onOpenPosition={onOpenPosition} />` for Positions.
Leave Run history and relevance settings behavior unchanged.

- [ ] **Step 8: Run the focused E2E and typecheck**

Run:

```bash
bun run test:e2e -- --grep "discovers and processes positions"
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/web/client/ScoutPositionReview.tsx src/web/client/GigScoutPage.tsx src/web/client/styles.css src/web/e2e/gig-scout.e2e.ts
git commit -m "feat: add Scout position review ledger"
```

---

### Task 3: Reliable Decisions, Scroll Continuity, and Authoritative Refresh

**Files:**
- Modify: `src/web/client/ScoutPositionReview.tsx`
- Create: `src/web/test/client/scout-position-review.test.ts`
- Modify: `src/web/e2e/gig-scout.e2e.ts`

**Interfaces:**
- Consumes: Task 2 `ScoutPositionReview` and existing decision/retry endpoints
- Produces: `nearestPageOffset(total: number, offset: number, limit: number): number`
- Produces: one in-flight decision guard and authoritative post-decision refresh

- [ ] **Step 1: Add failing pagination helper tests**

Create `src/web/test/client/scout-position-review.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { nearestPageOffset } from "../../client/ScoutPositionReview";

describe("Scout position review pagination", () => {
  test("keeps a valid offset and repairs an empty final page", () => {
    expect(nearestPageOffset(39, 20, 20)).toBe(20);
    expect(nearestPageOffset(20, 20, 20)).toBe(0);
    expect(nearestPageOffset(0, 20, 20)).toBe(0);
  });

  test("rejects invalid pagination inputs", () => {
    expect(() => nearestPageOffset(-1, 0, 20)).toThrow();
    expect(() => nearestPageOffset(1, -1, 20)).toThrow();
    expect(() => nearestPageOffset(1, 0, 0)).toThrow();
  });
});
```

- [ ] **Step 2: Add failing decision-continuity browser assertions**

Extend `gig-scout.e2e.ts` to record and assert:

```ts
const beforeScroll = await page.evaluate(() => window.scrollY);
await drawer.getByLabel("Private note (optional)").fill("Synthetic review note");
await drawer.getByRole("button", { name: "Mark irrelevant" }).click();
await expect(drawer).toHaveCount(0);
await expect(ledger.getByText("Head of Orchard Technology")).toHaveCount(0);
await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeScroll);
await expect(page.getByLabel("View")).toHaveValue("needs_user_review");
```

Add request interception for one synthetic decision failure and assert that the
drawer, row, note, and error remain visible after controls re-enable.

- [ ] **Step 3: Run the focused tests and verify the RED state**

Run:

```bash
bun test src/web/test/client/scout-position-review.test.ts
bun run test:e2e -- --grep "discovers and processes positions"
```

Expected: FAIL because pagination repair, authoritative refresh, explicit
in-flight state, and scroll restoration are not implemented.

- [ ] **Step 4: Implement pagination repair**

Export:

```ts
export function nearestPageOffset(
  total: number,
  offset: number,
  limit: number,
): number {
  if (![total, offset, limit].every(Number.isInteger)
    || total < 0 || offset < 0 || limit <= 0) {
    throw new Error("Invalid Scout position pagination.");
  }
  if (total === 0) return 0;
  return Math.min(offset, Math.floor((total - 1) / limit) * limit);
}
```

When a list response reports an invalid current offset, update the offset and
let the existing effect load that page exactly once.

- [ ] **Step 5: Implement guarded decisions and note preservation**

Track `submittingAction: "pursue" | "irrelevant" | "defer" | null`. Return
early when non-null and disable all decision controls. Submit the existing body
with `note: note.trim() || undefined`. On HTTP failure, preserve `selected`,
`detail`, `note`, and `reviewAt`; show the returned error and clear only the
in-flight state.

For 409 responses, refetch the selected detail and show the existing revised
review message before permitting another decision.

- [ ] **Step 6: Implement responsive local removal plus authoritative refresh**

Before removing a successful row, capture `window.scrollX` and
`window.scrollY`. Remove the selected id from local items, close the drawer,
clear the note/review time, decrement the displayed total responsively, and
restore the exact scroll coordinates in `requestAnimationFrame`.

Then trigger one existing list load with the current filters, sort, offset, and
limit. Replace items, counts, and total with that response. Apply
`nearestPageOffset` if the server total invalidates the page. Do not reset
filters, sorting, or selection to another row.

- [ ] **Step 7: Preserve promotion retry under the same state machine**

Disable Retry promotion while it is in flight. A successful retry follows the
same local removal, scroll restoration, and authoritative refresh. A failed
retry keeps the drawer open and shows the persisted failure message.

- [ ] **Step 8: Run focused tests**

Run:

```bash
bun test src/web/test/client/scout-position-review.test.ts
bun run test:e2e -- --grep "discovers and processes positions"
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/web/client/ScoutPositionReview.tsx src/web/test/client/scout-position-review.test.ts src/web/e2e/gig-scout.e2e.ts
git commit -m "fix: keep Scout review decisions in sync"
```

---

### Task 4: Agent-Panel Exclusivity and Description-View Browser Coverage

**Files:**
- Modify: `src/web/client/App.tsx`
- Modify: `src/web/client/GigScoutPage.tsx`
- Modify: `src/web/client/ScoutPositionReview.tsx`
- Modify: `src/web/e2e/gig-scout.e2e.ts`
- Modify: `src/web/test/client/document-viewer.test.ts`

**Interfaces:**
- Consumes: Task 2 `onOpenPosition()` callback
- Consumes: Task 1 Scout-description route and Back behavior
- Produces: exactly one visible right-side workspace

- [ ] **Step 1: Add failing Agent/drawer exclusivity assertions**

In `gig-scout.e2e.ts`, before opening the position row:

```ts
await page.getByRole("button", { name: /Ask GigFinderAgent/ }).click();
await expect(page.locator("#gig-finder-agent")).toContainText("Ask GigFinder");
await ledger.getByRole("button", { name: /Head of Orchard Technology/ }).click();
await expect(page.getByRole("button", { name: /Ask GigFinderAgent/ }))
  .toHaveAttribute("aria-expanded", "false");
await expect(page.getByRole("dialog", { name: "Head of Orchard Technology" }))
  .toBeVisible();
```

- [ ] **Step 2: Add failing description expand/view/Back assertions**

Use Playwright's popup event:

```ts
const drawer = page.getByRole("dialog", { name: "Head of Orchard Technology" });
await drawer.getByRole("button", { name: "Expand full description" }).click();
await expect(drawer.locator(".scout-review-description"))
  .toHaveClass(/is-expanded/);

const popupPromise = page.waitForEvent("popup");
await drawer.getByRole("link", { name: /Open Head of Orchard Technology in document view/ }).click();
const viewer = await popupPromise;
await expect(viewer.getByRole("heading", { name: "Head of Orchard Technology" })).toBeVisible();
await expect(viewer.getByText(/synthetic orchard description/)).toBeVisible();
await viewer.getByRole("button", { name: "Back" }).click();
await expect.poll(() => viewer.isClosed()).toBeTrue();
await expect(drawer).toBeVisible();
```

Add a direct navigation to the same viewer route and assert Back reaches
`/?workspace=scout` and displays the Positions view.

- [ ] **Step 3: Run the focused E2E and verify the RED state**

Run:

```bash
bun run test:e2e -- --grep "discovers and processes positions"
```

Expected: FAIL because `App` does not close the Agent panel before opening a
position and the final description interactions are not wired.

- [ ] **Step 4: Wire Agent closure from the application owner**

In `App.tsx`, pass:

```tsx
<GigScoutPage
  onOpenPosition={() => dispatchAgentWorkspace({ type: "close" })}
/>
```

Do not manipulate Agent DOM or duplicate Agent workspace state inside Scout.
`GigScoutPage` forwards the callback to `ScoutPositionReview`, and the row click
calls it before selecting the position.

- [ ] **Step 5: Complete document expansion and viewer navigation**

Keep `descriptionExpanded` local to the selected drawer and reset it when the
selected id changes. Use the Task 1 route helper for the link. Open the viewer
in a same-origin new browser context so its Back action can close it and reveal
the untouched drawer/list state.

- [ ] **Step 6: Add narrow-width containment assertions**

Set a narrow viewport in a separate test, open the drawer, and assert:

```ts
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
expect(overflow).toBeFalse();
await expect(drawer.locator(".scout-review-description"))
  .toHaveCSS("overflow-wrap", "anywhere");
```

- [ ] **Step 7: Run E2E, focused unit tests, and typecheck**

Run:

```bash
bun test src/web/test/client/document-viewer.test.ts src/web/test/client/scout-position-review.test.ts
bun run test:e2e -- --grep "Gig Scout"
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/web/client/App.tsx src/web/client/GigScoutPage.tsx src/web/client/ScoutPositionReview.tsx src/web/e2e/gig-scout.e2e.ts src/web/test/client/document-viewer.test.ts
git commit -m "feat: coordinate Scout and Agent review surfaces"
```

---

### Task 5: Product Documentation and Complete Verification

**Files:**
- Modify: `docs/product/006-gig-scout.md`
- Modify only if verification exposes a scoped defect: files already owned by Tasks 1–4

**Interfaces:**
- Consumes: completed web behavior from Tasks 1–4
- Produces: product contract and release-ready verified branch

- [ ] **Step 1: Update the product contract**

In `docs/product/006-gig-scout.md`, replace the operations-oriented Positions
language with a concise implemented behavior statement:

```md
The Positions workspace is a review-first ledger. Each row surfaces the
candidate-match score, position, company/location, and first-seen date. Opening
a row closes the Agent panel and uses the standard record drawer for an
optional note and Pursue, Mark irrelevant, or Defer. Job descriptions and
Scout processing diagnostics remain available as supporting detail; stored
Scout Markdown can expand in the drawer or open in GigFinder's document view.
```

Document that successful decisions remove the reviewed row while preserving
the current list location and refresh counts from authoritative state. Do not
edit architecture documentation or create an ADR.

- [ ] **Step 2: Run formatting and diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only #142 files changed.

- [ ] **Step 3: Run the complete required verification**

Run sequentially:

```bash
bun run check
bun run build
bun run test:e2e
```

Expected: all lint, typecheck, dependency architecture, unit/integration tests,
production build, and Playwright tests pass.

- [ ] **Step 4: Inspect production-boundary and privacy scope**

Run:

```bash
git diff --name-only main...HEAD
git diff --stat main...HEAD
rg -n "scout_position_|INSERT|UPDATE|ALTER TABLE|CREATE TABLE" src/web docs/product/006-gig-scout.md
```

Expected: no migration or persistence edits, no new private data, and no Scout
SQL introduced in web code.

- [ ] **Step 5: Commit Task 5**

```bash
git add docs/product/006-gig-scout.md
git commit -m "docs: describe Scout position review workflow"
```

- [ ] **Step 6: Re-run verification on the exact final commit**

Run:

```bash
bun run check
bun run build
bun run test:e2e
git status --short
git rev-parse HEAD
```

Expected: all commands pass and the tracked worktree is clean.

---

### Task 6: Pull Request, Superpowers Review, and Release Handoff

**Files:**
- No application files unless review finds a concrete defect
- Update: GitHub issue #142 and pull-request evidence

**Interfaces:**
- Consumes: clean exact HEAD from Task 5
- Produces: reviewed, verified PR linked with `Closes #142`

- [ ] **Step 1: Push the feature branch and open the PR**

```bash
git push -u origin issue-142-position-review-ui
gh pr create --base main --head issue-142-position-review-ui \
  --title "Make Scout position review usable" \
  --body "Closes #142"
```

Expand the PR body with scope, verification evidence, and the exact HEAD SHA.

- [ ] **Step 2: Run the required Superpowers review loop**

Use `superpowers:requesting-code-review` against the exact PR head. Resolve
every Critical/Important finding with TDD, commit, push, and request fresh
review. A later commit invalidates prior final review evidence.

- [ ] **Step 3: Run exact-head release verification and change overview**

After final Superpowers approval, run the repository `release-verifier` and
`change-overview` agents against the exact PR head. Record their exact-SHA
evidence on the PR. Any later commit requires fresh final review, release
verification, and change overview.

- [ ] **Step 4: Watch required GitHub checks**

```bash
gh pr checks --watch
```

Expected: required validation passes; PR container publication is skipped as
configured.

- [ ] **Step 5: Present the release-ready PR for deployment approval**

Report the PR URL, exact reviewed SHA, normal verification, release-verifier
result, change overview, and CI result. Do not merge or deploy until the user
approves production rollout; use the `deployer` agent for that rollout.

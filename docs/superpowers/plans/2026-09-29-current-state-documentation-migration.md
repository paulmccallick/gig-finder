# Current-state documentation migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `gig-finder-spec` the verified, navigable current-state documentation source and remove the superseded documentation corpus from GigFinder.

**Architecture:** Use application source and automated tests as the evidence baseline, then integrate confirmed claims into the external specification's existing document graph. Make focused commits in the external spec repository and the application repository, and keep migration evidence in GitHub rather than the permanent specification.

**Tech Stack:** Markdown, Bun 1.3.14, `gig-finder-spec/validate-docs.ts`, GitHub CLI, Git.

**Spec:** `docs/superpowers/specs/2026-09-29-current-state-documentation-migration-design.md`

## Global Constraints

- Application code and automated tests are the current-state authority; legacy prose is a discovery aid only.
- Preserve imported ADR text, dates, statuses, and decisions; change only formatting or link markup within them.
- Do not invent requirements or change application behavior to conform to old documentation.
- Do not commit personal data, credentials, logs, database files, backups, or local state.
- Preserve user-owned in-progress migration edits; review them as candidate documentation rather than discarding or blindly accepting them.
- Do not use sibling-checkout-relative links from GigFinder; use stable repository URLs for external documentation entrypoints.
- Run `bun validate-docs.ts` in `../gig-finder-spec`; run `bun run check` and `bun run build` in GigFinder before release verification.
- Keep classifications, evidence, validation output, and unresolved discrepancies in issue #157 or its pull request.

## Review Focus

- Broken external links and anchors must fail `bun validate-docs.ts` and be repaired in Task 2.
- Unsupported capability claims must be corrected or excluded, with the discrepancy recorded in Task 1.
- Imported ADRs must retain statuses plus Context, Decision, and Consequences; Task 2 validates this.
- README and `AGENTS.md` must remain useful after local docs are deleted; Task 3 verifies entrypoints.
- Dirty migration work must not be accidentally omitted from focused migration commits; Tasks 2 and 3 inspect staged paths.

---

## File structure

| Repository | Paths | Responsibility |
| --- | --- | --- |
| `gig-finder` | `docs/product/*.md`, `docs/architecture/**/*.md` | Legacy source material to classify and delete after integration. |
| `gig-finder` | `README.md`, `AGENTS.md` | Stable external-spec entrypoints and agent guidance. |
| `gig-finder-spec` | `MAP.md`, `APPLICATION.md`, `README.md`, `AGENTS.md` | Discovery, scope, validation, and authoring entrypoints. |
| `gig-finder-spec` | `capabilities/`, `workflows/`, `domain/`, `interfaces/`, `architecture/`, `operations/`, `requirements/` | Code-verified current-state documentation. |
| `gig-finder-spec` | `decisions/README.md`, `decisions/0001-*.md`–`0017-*.md` | Preserved ADR navigation and original decision records. |
| GitHub issue #157 / PR | Audit comment/body | Classifications, evidence, validation, and discrepancies. |

### Task 1: Create the evidence-backed audit record

**Files:**
- Read: `docs/product/*.md`, `docs/architecture/**/*.md`
- Read: `src/core/`, `src/data/`, `src/web/`, `src/agent/`, `src/cli/`, `src/operations/`, and matching tests
- Modify: GitHub issue #157 or its PR description/comment

**Interfaces:**
- Consumes: legacy corpus and application source/test evidence.
- Produces: a Markdown table with `legacy source`, `preserve/correct/retire`, `external destination or reason`, `code/test evidence`, and `discrepancy` columns.

- [ ] **Step 1: Capture a complete legacy inventory**

Run: `rg --files docs/product docs/architecture | sort`

Expected: all product documents, the template, architecture files, and 17 ADRs are included before removal.

- [ ] **Step 2: Trace product behavior claims to current evidence**

For opportunities, networking, tasks, agent conversations, managed documents, and Scout, use matching core services, adapters/routes, schemas, and focused tests to choose Preserve, Correct, or Retire. Do not resolve unsupported prose through code changes.

- [ ] **Step 3: Trace architecture, operations, and ADR claims**

Use composition roots, persistence, queue runtime, operations scripts, deployment tests, and ADR status/sections to classify configuration, infrastructure, deployment, overview, and every decision record.

- [ ] **Step 4: Publish the audit record**

Post the complete table and concise discrepancy list to issue #157 or its PR, citing a source/test path for every Preserve or Correct row.

- [ ] **Step 5: Check audit coverage**

Compare the published table to the Task 1 inventory. Expected: every inventory path appears once and no unresolved claim has become a requirement.

### Task 2: Integrate verified material into `gig-finder-spec`

**Files:**
- Modify: `../gig-finder-spec/{MAP.md,APPLICATION.md,README.md,AGENTS.md}`
- Modify: `../gig-finder-spec/{capabilities,workflows,domain,interfaces,architecture,operations,requirements}/**/*.md`
- Modify: `../gig-finder-spec/decisions/README.md`
- Preserve with link/format-only changes: `../gig-finder-spec/decisions/0001-*.md`–`0017-*.md`
- Test: `../gig-finder-spec/validate-docs.ts`

**Interfaces:**
- Consumes: Task 1's classification table and cited evidence.
- Produces: a validated external documentation graph reachable from `MAP.md`.

- [ ] **Step 1: Assign every Preserve or Correct row one external owner**

Map candidate behavior to capabilities; lifecycles/concepts to workflows or domain; boundaries to interfaces; and implementation or operational facts to architecture, operations, or requirements. Eliminate duplicate or unsupported in-progress prose.

- [ ] **Step 2: Correct only evidence-backed external documentation**

Update the assigned documents, including front matter and one rendered `## Related documents` section for non-ADR files. Each related entry must also be a clickable body link. Update evidence revision/date references to the audited source revision.

- [ ] **Step 3: Preserve and index imported decisions**

Keep each ADR's recorded status and `## Context`, `## Decision`, and `## Consequences` text intact; repair only Markdown link markup. Ensure the decision index and owning architecture documents link to each record.

- [ ] **Step 4: Run external documentation validation**

Run: `bun validate-docs.ts`

Working directory: `../gig-finder-spec`

Expected: exit code 0, confirming metadata, headings, links/anchors, Related documents links, and map reachability.

- [ ] **Step 5: Commit the external-spec integration**

Inspect `git -C ../gig-finder-spec status --short`; stage only issue #157 documentation paths, explicitly excluding `.serena/` and unrelated work. Commit with `docs: migrate GigFinder current-state specification`, then add validator output and SHA to issue #157/PR.

### Task 3: Replace GigFinder entrypoints and retire the legacy corpus

**Files:**
- Modify: `README.md`, `AGENTS.md`
- Delete: `docs/product/`, `docs/architecture/`
- Test: repository link scan and `bun run check`

**Interfaces:**
- Consumes: Task 2's committed, validated external documentation graph and Task 1's audit record.
- Produces: stable GigFinder entrypoints with no local current-state product/architecture corpus.

- [ ] **Step 1: Update README links**

Replace local product, architecture, configuration, and deployment links with stable GitHub links to the appropriate external map or owner document. Retain development/production instructions owned by this repository.

- [ ] **Step 2: Update agent guidance**

Replace deleted local-document paths with the external documentation entrypoint and remove Superpowers-specific workflow requirements. Preserve project workflow stages and GitHub orchestration rules.

- [ ] **Step 3: Delete classified legacy documents**

Remove `docs/product/` and `docs/architecture/`, including the PRD template and all 17 local ADRs, only after every Preserve or Correct row has a validated external destination.

- [ ] **Step 4: Verify retirement and entrypoints**

Run `rg -n "docs/(product|architecture)|\.\./\.\./\.\./gig-finder-spec|Superpowers-specific" README.md AGENTS.md .github package.json || true`, `test ! -d docs/product`, and `test ! -d docs/architecture`.

Expected: no obsolete local documentation or sibling-relative external link remains; both directories are absent.

- [ ] **Step 5: Run static verification and commit**

Run: `bun run check`

Expected: exit code 0. Stage only `README.md`, `AGENTS.md`, and the audited removals; commit with `docs: point GigFinder to external specification`.

### Task 4: Validate exact revisions and hand off for verification

**Files:**
- Modify: GitHub issue #157 or its PR description/comment
- Read: exact commit heads in both repositories

**Interfaces:**
- Consumes: Task 2 and Task 3 commits.
- Produces: exact-revision validation evidence and complete issue/PR handoff.

- [ ] **Step 1: Re-run the spec validator at committed HEAD**

Run `git -C ../gig-finder-spec status --short` and `bun validate-docs.ts` in `../gig-finder-spec`.

Expected: migration paths are clean and validation passes against the recorded SHA.

- [ ] **Step 2: Build GigFinder at its committed HEAD**

Run: `bun run build`

Expected: exit code 0 after Task 3's successful static verification.

- [ ] **Step 3: Final link and repository inspection**

Run `git status --short --branch`, `git -C ../gig-finder-spec status --short --branch`, and the Task 3 link scan. Expected: only explicitly preserved unrelated user work remains and no retired-doc reference exists.

- [ ] **Step 4: Complete GitHub evidence and request release verification**

Add both SHAs, exact successful command outputs, classification table, and unresolved discrepancies to issue #157/PR. Move issue #157 to Verification; run `release-verifier` and `change-overview` against the exact application branch revision. Return the issue to Development if either finds a migration defect.

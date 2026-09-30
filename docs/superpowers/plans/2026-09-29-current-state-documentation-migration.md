# Minimal current-state documentation migration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issue #157 with local-only cross-repository references and the smallest evidence-justified documentation diff.

**Architecture:** `gig-finder-spec` owns a `gf-ref` resolver for repository-qualified references such as `app::src/core/services.ts`. Repository locations live in user Git configuration; resolution never uses the network. The spec migration restarts from its pre-migration baseline, mechanically converts only cross-repository link targets, imports the existing ADRs unchanged, and admits prose edits only for source-proven corrections or unique retained facts.

**Tech Stack:** Bun 1.3.14, TypeScript, Markdown, Git configuration, Git.

**Spec:** `docs/superpowers/specs/2026-09-29-current-state-documentation-migration-design.md`

## Global constraints

- Resolve cross-repository references only from registered local checkouts; never construct, open, fetch, or fall back to a URL.
- Use `app::` and `spec::` aliases; do not encode sibling layout or absolute paths in tracked files.
- Keep same-repository Markdown links relative and clickable.
- Start the specification diff from remote `main` at `d06bc820e538841d20995a1393a5e7a0cdb0eafa`.
- Do not rewrite surrounding prose during mechanical reference conversion.
- Preserve all imported ADR text, dates, statuses, Context, Decision, and Consequences.
- Every prose edit must correct a source-proven contradiction or retain unique current information required before deleting its legacy owner.
- Do not commit `.serena/`, temporary repositories, local path registrations, personal data, credentials, logs, databases, or backups.
- Use focused commits per repository. Run `bun validate-docs.ts` in `gig-finder-spec`; run `bun run check` and `bun run build` in GigFinder.

## Review focus

- A checkout registered outside a sibling layout resolves successfully; Task 2 tests unrelated temporary locations.
- Unknown aliases, traversal paths, missing registrations/files, wrong repository markers, and unmatched symbols fail without network access; Task 2 tests each case.
- Markdown parsing distinguishes `app::`/`spec::` targets from ordinary relative links and URL schemes; Task 3 tests extraction and runs the complete validator.
- Mechanical conversion changes link targets only; Task 3 compares normalized pre/post Markdown content.
- The migration does not delete unique legacy information or retain unsupported prose; Task 4 records source evidence for every prose edit and validates every destination.

---

### Task 1: Remove the superfluous specification diff

**Files:**
- Modify through Git revert: all paths changed by `c7900cc67f3aef82d59dbb061ccae0873752b198` in `../gig-finder-spec`

**Interfaces:**
- Consumes: remote spec `main` baseline `d06bc82` and current spec PR head `c7900cc`.
- Produces: a spec feature branch whose tree matches `d06bc82`, ready for minimal changes.

- [ ] **Step 1: Create or switch to the spec feature branch**

Create `issue-157-current-state-documentation-migration` at the current spec head and set its upstream to the existing remote feature branch. Preserve untracked `.serena/`.

- [ ] **Step 2: Revert the broad migration commit**

Run: `git revert --no-edit c7900cc67f3aef82d59dbb061ccae0873752b198`

Expected: the committed tree matches `d06bc82`; `.serena/` remains untracked and untouched.

- [ ] **Step 3: Verify the clean baseline diff**

Run: `git diff --exit-code d06bc820e538841d20995a1393a5e7a0cdb0eafa..HEAD`

Expected: exit 0 and no content diff.

### Task 2: Add the local repository-reference resolver

**Files:**
- Create: `../gig-finder-spec/.gf-repository`
- Create: `.gf-repository`
- Create: `../gig-finder-spec/repository-ref.ts`
- Create: `../gig-finder-spec/repository-ref.test.ts`
- Create: `../gig-finder-spec/gf-ref.ts`

**Interfaces:**
- Consumes: Git configuration keys `gigfinder.repo.app` and `gigfinder.repo.spec`; repository markers containing exactly `app` or `spec`.
- Produces: `parseRepositoryReference(value)`, `registerRepository(alias, checkout, environment?)`, `resolveRepositoryReference(value, environment?)`, `checkRepositoryReference(value, environment?)`, and CLI commands `register`, `path`, `show`, and `check`.

- [ ] **Step 1: Write failing resolver tests**

Add tests proving parsing, registration in unrelated temporary checkout locations, absolute-path resolution, file display, and optional `#symbol=<token>` checks. Add failure cases for unknown aliases, `..` traversal, missing registration, wrong `.gf-repository` identity, missing files, and unmatched symbols. Use synthetic repositories under `tmp/` and an isolated `GIT_CONFIG_GLOBAL`; clean them after the tests.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `bun test repository-ref.test.ts`

Expected: FAIL because `repository-ref.ts` and resolver behavior do not exist.

- [ ] **Step 3: Implement the resolver and CLI**

Use `git config --global --path` for registration and lookup. Canonicalize the checkout with `git -C <checkout> rev-parse --show-toplevel`, verify `.gf-repository`, reject paths that escape the repository root, and use only local filesystem reads. The CLI must make no HTTP, Git fetch, clone, or remote calls.

- [ ] **Step 4: Run the resolver tests and verify GREEN**

Run: `bun test repository-ref.test.ts`

Expected: all resolver tests pass and leave no `tmp/` content.

- [ ] **Step 5: Commit the resolver and repository markers**

Commit the resolver and `spec` marker in `gig-finder-spec` with subject
`feat: resolve documentation references locally`. Commit the `app` marker in
GigFinder with subject `chore: identify the application repository` so Task 3
can validate actual local application references.

### Task 3: Convert cross-repository targets without rewriting prose

**Files:**
- Modify: `../gig-finder-spec/validate-docs.ts`
- Modify: the 26 pre-migration Markdown files containing the 113 `../../gig-finder/...` cross-repository targets
- Test: `../gig-finder-spec/repository-ref.test.ts`

**Interfaces:**
- Consumes: Task 2 parsing and checking functions.
- Produces: Markdown targets such as `[GigDomainService](app::src/core/gig-domain-service.ts)` and validation of every logical reference against registered local checkouts.

- [ ] **Step 1: Add failing Markdown-reference tests**

Test that repository-qualified Markdown targets are extracted and checked, ordinary relative links remain under existing validation, unrelated schemes are ignored, and missing logical targets fail validation.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test repository-ref.test.ts`

Expected: the new Markdown extraction/validation tests fail.

- [ ] **Step 3: Extend validation minimally**

Teach `validate-docs.ts` to recognize `app::` and `spec::` targets before its generic URI-scheme skip and check them through Task 2. Do not change metadata, heading, related-path, or ordinary-link rules.

- [ ] **Step 4: Mechanically convert only cross-repository link targets**

Convert each baseline target resolving under `gig-finder` to its repository-root-qualified `app::` target. Preserve Markdown labels, surrounding sentences, headings, metadata, spacing, and same-repository links.

- [ ] **Step 5: Verify the conversion guard and validator**

Use a read-only comparison that normalizes the old targets and proves all other text matches `d06bc82`. Register both current checkouts in an isolated repository-local Git config, then run `bun test repository-ref.test.ts` and `bun validate-docs.ts`.

Expected: 113 logical application references; no cross-repository GitHub or filesystem-relative targets; tests and validation pass.

- [ ] **Step 6: Commit the reference conversion**

Commit in `gig-finder-spec` with subject `docs: resolve application evidence locally`.

### Task 4: Import only required decisions and source-proven corrections

**Files:**
- Create unchanged: `../gig-finder-spec/decisions/0001-*.md` through `0017-*.md`
- Modify minimally: `../gig-finder-spec/decisions/README.md`
- Modify only if evidence requires it: `../gig-finder-spec/architecture/gig-scout.md`, `operations/deployment.md`, `architecture/persistence.md`, `interfaces/gig-scout.md`, `workflows/gig-scout-discovery.md`, `workflows/gig-scout-review-processing.md`, `operations/observability.md`, `domain/interactions.md`

**Interfaces:**
- Consumes: issue #157's audit, the legacy documents at application baseline `5fc45b3`, and current application source/tests.
- Produces: preserved ADRs plus the minimum current-state corrections needed before legacy deletion.

- [ ] **Step 1: Import and compare the ADRs**

Import all 17 ADRs verbatim from application baseline `5fc45b3`. Add only direct index links needed to discover them. Compare each imported file byte-for-byte with its source; if link markup must change, normalize only that markup before comparison.

- [ ] **Step 2: Apply the factual-correction gate**

For each candidate file, identify the exact baseline sentence, exact source/test evidence that contradicts it or supplies unique retained information, and the smallest replacement. Cover only: Scout queue ownership and count; configuration fallback/validation/precedence; tracked templates versus private runtime configuration; implemented Scout stages; operational logging; and meeting-participant migration mapping. If the baseline is already accurate or the fact is duplicated, do not edit it.

- [ ] **Step 3: Validate the minimal content diff**

Run the spec validator with isolated local registrations. Inspect `git diff --word-diff d06bc82 --` and confirm every non-reference prose hunk has an evidence entry from Step 2.

- [ ] **Step 4: Commit preserved decisions and corrections**

Commit in `gig-finder-spec` with subject `docs: preserve verified GigFinder decisions`.

### Task 5: Make application entrypoints local and resolver-based

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 2's `gf-ref` CLI and `spec::` alias.
- Produces: agent and maintainer entrypoints that open the local specification without URLs or sibling assumptions.

- [ ] **Step 1: Write the failing entrypoint scan**

Run a scan that fails while `README.md` or `AGENTS.md` contains `github.com/paulmccallick/gig-finder-spec`, a sibling-relative spec path, or lacks `spec::MAP.md` and the local resolver instruction.

- [ ] **Step 2: Update only the entrypoint references**

Replace external-spec URL targets with `spec::` references and the minimum command needed to locate the registered spec checkout and invoke `gf-ref`. Preserve all unrelated README and workflow prose.

- [ ] **Step 3: Verify entrypoints and application checks**

Run the entrypoint scan, `bun run check`, and `bun run build`.

Expected: scan passes; all application checks and build pass.

- [ ] **Step 4: Commit the application entrypoints**

Commit with subject `docs: resolve specification locally`.

### Task 6: Exact-revision review and PR repair

**Files:**
- Modify: issue #157, `gig-finder-spec` PR #1, and GigFinder PR #160 descriptions/comments

**Interfaces:**
- Consumes: exact application and specification heads from Tasks 4 and 5.
- Produces: focused PRs with current evidence and no stale claims about the superseded broad migration.

- [ ] **Step 1: Run final exact-head checks**

Run `bun test repository-ref.test.ts` and `bun validate-docs.ts` in `gig-finder-spec`; run `bun run check` and `bun run build` in GigFinder. Verify both worktrees contain only explicitly preserved unrelated state.

- [ ] **Step 2: Audit final diff scope**

Classify every changed spec file as resolver, target-only conversion, ADR/index, or evidence-backed correction. Reject any unclassified file or prose hunk. Confirm the application diff contains only the approved design/plan, entrypoints/marker, and previously audited legacy removals.

- [ ] **Step 3: Push both branches and update both PRs**

Push without merging. Replace stale PR summaries with exact heads, validation output, reference counts, factual-correction list, and release ordering.

- [ ] **Step 4: Run required exact-head reviewers**

Run `release-verifier` and `change-overview` against the final GigFinder PR revision and include spec PR #1 as a dependency. Return the issue to Development if either finds a defect; do not enter Release without user approval.

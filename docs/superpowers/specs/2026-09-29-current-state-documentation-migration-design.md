# Current-state documentation migration design

**Issue:** #157  
**Status:** Approved design  
**Date:** 2026-09-29

## Purpose

Make the sibling `gig-finder-spec` repository the only current-state product
and architecture documentation source for GigFinder. The application repository
will retain only code, operational entrypoints, and links to the external
specification. A reader must be able to start at the external specification's
map, navigate all current behavior and architecture documentation, and trace
claims to the current application implementation.

This migration does not change application behavior, deployment behavior, or
the text, date, status, or decisions recorded in the existing ADRs.

## Scope and boundaries

### In scope

- Audit every file in `gig-finder/docs/product/` and
  `gig-finder/docs/architecture/`, including the legacy PRD template and all
  ADRs.
- Audit the in-progress documentation in `gig-finder-spec` against current
  application source and tests.
- Classify every legacy document as **preserve**, **correct**, or **retire**;
  record the classification and any unresolved code/spec disagreement in issue
  #157 or its pull request rather than in a permanent spec appendix.
- Integrate only verified current-state content into the existing external
  spec structure: map, application overview, capabilities, workflows, domain,
  interfaces, architecture, operations, requirements, and decisions.
- Preserve imported ADR bodies and statuses. Only formatting and link repair
  may change within an imported ADR.
- Replace application-repository documentation entrypoints with external-spec
  links, remove the obsolete local product/architecture corpus and template,
  and remove Superpowers-specific workflow wording from the application
  `AGENTS.md`.
- Validate the spec repository with `bun validate-docs.ts`, then validate the
  application repository's links and relevant project checks.

### Out of scope

- Implementing undocumented product features or changing runtime contracts to
  match legacy prose.
- Creating a permanent migration history or discrepancy appendix in the spec.
- Rewriting ADR rationale, changing ADR status, or inventing performance,
  availability, security, or support commitments that code does not establish.
- Moving personal data, private logs, database contents, or other local state
  into either repository.

## Evidence and audit model

Application code and its automated tests are the current-state authority.
Legacy documentation is a discovery aid only. The integrator will use the
external spec repository's documentation map and authoring rules to determine
where verified material belongs.

For each legacy document, the audit will record:

| Classification | Meaning | Action |
| --- | --- | --- |
| Preserve | Its current-state claim is supported by source/tests and is needed in the spec. | Keep or incorporate the verified material in the appropriate external document. |
| Correct | It contains useful material but has unsupported, stale, incomplete, or misplaced claims. | Update the external document to the code-supported statement; report the discrepancy. |
| Retire | It is historical, duplicated, templated, unsupported, or superseded by verified external documentation. | Do not copy it; remove it with the legacy corpus. |

Evidence must cite concrete application locations such as a core service,
route, client adapter, schema, composition root, operation script, or test.
When evidence conflicts or is insufficient, the external spec must state the
confirmed limit or omit the claim; the discrepancy belongs in the issue/PR.

## Repository design

### `gig-finder-spec`

The existing map remains the single discovery entrypoint. The integration
updates only the documents that own the verified material:

- Capability documents describe candidate-facing behavior and rules.
- Workflow and domain documents describe lifecycle and terminology.
- Interface documents describe browser, HTTP, CLI, and agent boundaries.
- Architecture and operations documents describe implementation, persistence,
  deployment, observability, and recovery.
- The decision index links each preserved imported ADR from the owning
  architecture material.

Each current-state document must retain valid metadata, rendered related-links,
and reachable navigation required by `validate-docs.ts`. Imported ADRs remain
an explicit exception to the newer document format, retaining their original
structure and status.

### `gig-finder`

The README becomes the application-repository documentation entrypoint and
links readers to the external specification map and any necessary operational
guidance there. `AGENTS.md` directs agents to the external documentation and
does not require the removed Superpowers workflow. The local
`docs/product/` and `docs/architecture/` trees, including the PRD template,
are removed after their audit classifications are recorded.

No local document may retain a relative filesystem link into the sibling
repository: those links work only in one checkout layout. Entrypoints must use
stable repository URLs or repository-relative documentation links appropriate
to where they render.

## Existing work and integration rules

Both repositories contain user-owned, uncommitted migration edits. They are
in scope as in-progress work, but are not assumed correct merely because they
exist. The integrator will preserve them, review their claims and links against
code and the external validator, and make focused corrections in place. The
Grooming spec and plan are the only commits created before Development; they
must not accidentally stage the user-owned migration changes.

The eventual implementation uses focused commits per repository: one for the
external spec migration and one for the application-repository cleanup and
entrypoints. The issue/PR includes the audit classification table, exact
validation output, and unresolved discrepancies.

## Error handling and validation

- A broken external-spec link, missing required document section, invalid
  metadata, or unreachable document is corrected before the spec validation
  passes.
- An unsupported legacy statement is removed or qualified by verified code
  evidence; it is never made true through an unrelated code change.
- A missing or ambiguous application behavior is reported as an unresolved
  discrepancy rather than guessed.
- Before deleting local documentation, the audit confirms that all material
  classified Preserve or Correct has a validated external destination.
- Final checks run on the exact proposed revisions: `bun validate-docs.ts` in
  `gig-finder-spec`, followed by the applicable application checks (including
  documentation link checks and `bun run check`/`bun run build` when the
  application project configuration requires them).

## Acceptance criteria

1. `gig-finder-spec` validates with `bun validate-docs.ts`.
2. GigFinder contains no local current-state `docs/product` or
   `docs/architecture` corpus, ADR directory, or obsolete PRD template.
3. GigFinder's README and agent instructions route readers to
   `gig-finder-spec` without sibling-checkout-relative links or
   Superpowers-specific requirements.
4. The external spec contains only code-verified current-state material,
   reachable from its map, with imported ADRs preserved.
5. The issue or pull request records classifications, evidence, validation,
   and unresolved discrepancies.
6. Each repository has a clean, validated baseline after its focused commit.

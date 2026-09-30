# Current-state documentation migration design

**Issue:** #157
**Status:** Revised design awaiting approval
**Date:** 2026-09-30

## Purpose

Make `gig-finder-spec` the current-state product and architecture documentation
repository without making agents depend on GitHub URLs or a particular local
checkout layout. Preserve useful existing documentation and change only what is
required to complete the migration.

This migration does not change application behavior, deployment behavior, or
the recorded text and status of existing architecture decisions.

## Repository references

Cross-repository references use a repository alias and a path from that
repository's root:

```text
app::src/core/services.ts#symbol=OpportunitiesService
spec::architecture/opportunities.md
```

`app` identifies the `gig-finder` repository. `spec` identifies the
`gig-finder-spec` repository. These identifiers do not encode a filesystem
layout, host, owner, URL, or branch.

Ordinary relative Markdown links remain appropriate between files in the same
repository. They must not cross the repository boundary.

## Local resolver

`gig-finder-spec` owns a small executable named `gf-ref`. It stores repository
locations in the user's Git configuration:

```text
gigfinder.repo.app
gigfinder.repo.spec
```

The resolver supports four operations:

- `gf-ref register <alias> <checkout>` records and validates a local checkout.
- `gf-ref path <reference>` prints the resolved absolute local path.
- `gf-ref show <reference>` reads the referenced local file.
- `gf-ref check <reference>` verifies the repository, file, and optional
  fragment without printing file content.

Resolution always uses the registered local checkout and its working tree.
`gf-ref` does not construct URLs, access the network, clone repositories, fetch
Git revisions, or fall back to a remote source. A missing registration, missing
checkout, wrong repository identity, missing file, or unmatched fragment is an
actionable error.

The optional `symbol` fragment identifies a named declaration or other stable
source token within the file. Documentation should omit fragments when the file
itself is the appropriate evidence boundary.

## Agent workflow

Agent instructions in both repositories direct agents to resolve cross-repo
references from the local filesystem. From the application repository, an
agent obtains the registered specification root and uses its `gf-ref`
executable to open `spec::MAP.md`. From the specification repository, the same
resolver opens application evidence through `app::...` references.

If either checkout is not registered, the agent reports the missing local
prerequisite. It does not substitute a website.

## Migration scope

The migration starts from the pre-migration `gig-finder-spec` baseline. A file
may change only for one of these reasons:

1. Add or validate the local resolver.
2. Replace a cross-repository URL or filesystem-relative reference with a
   repository-qualified reference.
3. Import one of the 17 existing ADRs without changing its decision text,
   date, or status, and add the minimum navigation needed to find it.
4. Correct a concrete statement that conflicts with current application source
   or tests.
5. Move unique, current, source-supported information needed before deleting
   its legacy owner.
6. Remove the legacy application document after its required information has
   an external owner.

Reformatting, prose normalization, stylistic rewriting, reorganizing already
adequate documents, expanding explanations, and changing unrelated validation
rules are out of scope. Every changed file must be attributable to at least one
reason above. Mechanical reference conversion must not rewrite surrounding
prose.

## Validation

The specification validator continues to validate its local document graph. It
also recognizes repository-qualified references and checks them through the
registered local checkouts. Validation fails for an unknown alias, missing
registration, wrong repository, missing file, or unmatched fragment.

Tests for `gf-ref` use temporary local Git repositories and synthetic files.
They prove that resolution is independent of sibling placement and that no
network fallback occurs. Existing specification validation remains green.

The application repository continues to run `bun run check` and `bun run
build`. Its entrypoint scan rejects cross-repository GitHub URLs and
filesystem-relative references in agent guidance.

## Acceptance criteria

1. An agent can open specification and application evidence from registered
   local checkouts without accessing a URL.
2. Checkout locations may be unrelated; moving a checkout requires changing
   only user-local registration.
3. Cross-repository references contain neither a hardcoded Git URL nor a
   filesystem-relative path.
4. Same-repository Markdown navigation remains ordinary and clickable.
5. All 17 ADRs retain their original decision text, dates, and statuses.
6. Every remaining migration change has an explicit functional or factual
   reason; broad stylistic rewriting is removed from the pull request.
7. The local legacy corpus is removed only after each retained fact has a
   validated owner in `gig-finder-spec`.
8. Both repositories pass their required validation at the exact proposed
   revisions.

## Release ordering

The specification pull request is reviewed and merged before the application
pull request that removes the local documentation. Exact-head verification is
repeated after any commit. Neither pull request is merged without the normal
release approval.

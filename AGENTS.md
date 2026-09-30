# GigFinder Project Guide

Apply `$coding-guide` to implementation and review work.

Current-state product, architecture, interface, and operations documentation
lives in the [GigFinder specification repository](https://github.com/paulmccallick/gig-finder-spec).
Read its [documentation map](https://github.com/paulmccallick/gig-finder-spec/blob/main/MAP.md)
before changing behavior or contracts, then update the relevant specification
documents with the code change.

The backlog is the [GigFinder GitHub Project](https://github.com/users/paulmccallick/projects/5).

## Workflow

The stages are **Grooming → Development → Verification → Release → Done**.
The root agent moves the GitHub issue between stages, coordinates the work,
and performs GitHub actions.

- **Grooming:** Move the issue to Grooming. Define the scope and acceptance
  criteria, commit the approved specification and plan, and link both from the
  issue.
- **Development:** Move the issue to Development and create a branch from
  `main`. Implement the plan and complete review and project checks.
- **Pull request:** Push the feature branch and create or update its PR without
  prompting. Run checks against the exact proposed revision.
- **Verification:** Run `release-verifier` and `change-overview` against that
  revision. Return the issue to Development if verification finds a defect;
  repeat verification after any later commit.
- **Release:** Enter Release only after user approval and all checks against
  the exact revision pass. Move the issue to Release and invoke the deployer.
- **Done:** Move the issue to Done only after production verification.

Report blockers promptly. When work is delegated, the root agent waits for
the result and continues coordination.

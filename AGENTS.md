# Codex Project Guide

Apply `$coding-guide` to all implementation and review work. Before changing
behavior or contracts, read and update the relevant files in `docs/product/`
and `docs/architecture/`.

The backlog is the [GigFinder GitHub Project](https://github.com/users/paulmccallick/projects/5).

## Workflow

The workflow stages are **Grooming → Development → Verification -> Release → Done**. Root moves
the github issue between stages, orchestrates the overall process, and performs GitHub actions. Superpowers owns its
internal orchestration.

- **Grooming:** Move the issue to Grooming and invoke
  `$superpowers:brainstorming`. Follow its workflow through the approved,
  committed spec and its required transition to `$superpowers:writing-plans`.
  Commit the resulting plan and attach the spec and plan to the issue.
- **Development:** Move the issue to Development and create a branch from
  `main`. Invoke `$superpowers:subagent-driven-development` to execute the plan
  through final review and verification, including its required transition to
  `$superpowers:finishing-a-development-branch`.
- **Verification:** - Run the `release-verifier` and `change-overview` against the branch.
  Issues found during release verification revert the stage to Development.
  A later commit requires fresh verification.
- **Pull request:** Push the feature branch and
  create or update its PR without prompting.
  checks, `release-verifier`, and `change-overview` against that exact revision.
- **Release:** Enter Release only after user approval and all exact-head gates
  pass. Set the issue to Release. nvoke the deployer.
- **Done:** Move the issue to Done only after production verification.

While an agent is running, root waits and continues when it completes. Report
blockers immediately.

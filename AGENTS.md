# Codex Project Guide

The installed Superpowers workflow is authoritative for development. The rules
below are GigFinder-specific extensions.

Apply `$coding-guide` to all implementation and review work.

Before changing behavior or contracts, read the relevant files in
`docs/product/` and `docs/architecture/`. Update them in the same change and
stop if they conflict with the code.

The backlog is the [GigFinder GitHub
Project](https://github.com/users/paulmccallick/projects/5).

## Workflow

- Grooming
  - The issue is in Grooming in github
  - Superpowers does brainstorming and drives to commited spec and plan
  - spec and plan are attatched to GH issue
- Development
  - The issue moves to Development in Github
  - A branch is taken from main for feature development
  - Superpowers drives the development to its final review
  - A PR is created in Github with the changes
  - `release-verifier` is asked to verify the release
  - change overview agent is run against the changes with overview captured in an md file
  - Github runs PR checks which can be viewed via `gh pr checks --watch`
  - user must approve PR before moving to Release
- Release
  - Deployer agent drives the release process via the deployment skill
  - GH issue is moved to Done

## Root coordination

- The main thread is responsible for moving issues through the workflow
- The main thread should check on subagents periodically (maximum of 30 minutes)
- if a subagent has a blocking issue notify the user immediately
- if a subagent completes its task and no user input is needed the main agent moves to the next stage of the workflow

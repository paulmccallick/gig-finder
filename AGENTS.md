# Codex Project Guide

Read the relevant files in `docs/product/` and `docs/architecture/` before
changing behavior or contracts. Update them in the same change. If code and
documentation conflict, stop and flag it.

The backlog is the [GigFinder GitHub
Project](https://github.com/users/paulmccallick/projects/5).

## GitHub workflow

- The GitHub Project is the source of truth for issue status.
  - Backlog is for unrefined work,
  - Grooming is for defining requirements
  - Development is while implementing and verification
  - Done is means the issue has been signed off and deployed to production
- Create feature branches from `main`
- merges to main require a pull request linked with `Closes #<issue>`.

## Development rules

- Use Bun for package management, scripts, and tests.
- Use the ignored repository-local `tmp/` directory for temporary files; do
  not use `/private/tmp`.
- Never add real personal information, credentials, job-search records,
  documents, logs, SQLite files, or backups to source control. Development
  context belongs in ignored `context/`; production state uses standard Unix
  paths under `/var` and `/etc`.
- Use synthetic fixtures in tests and examples.
- Add regression tests for changed documented behavior.
- Run `bun run check` and `bun run build` for application changes.
- Run `bun run test:e2e` for dashboard behavior changes.
- Definition of done: required checks pass, their findings are fixed, and
  production-affecting changes are published, deployed, and verified.
- Limit scope to the requested feature
- Apply SOLID principles
- Be pragmatic - avoid unecessary obfuscation

## Sub Agent workflow

- development requires the user to ask for the issue to be implemented
- once all tests are passing the developer must commit, push, and create a PR
- a PR should spawn the code reviewer sub agent to do a code review
- the developer should resolve any found issues, and push
- fixes will initiate a code review

## Root coordination workflow

- Do not send a final response while requested subagent, review, CI, merge,
  publication, or deployment work remains active.
- Wait for subagent mailbox updates and continue the next documented workflow
  step without requiring a user prompt.
- Use `gh pr checks --watch` for required GitHub checks and continue when they
  complete.
- Provide periodic status updates while waiting.
- Finish only when the requested terminal state is reached or a concrete
  blocker requires user input.

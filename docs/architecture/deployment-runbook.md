# Deployment runbook

Environment layout is documented in
[Infrastructure environments](infrastructure.md). The release model and rollback
guarantees are defined by
[ADR 0007](decisions/0007-immutable-production-deployment.md).

## Pre-release smoke verification

Run both commands from a clean checkout of the exact commit being approved:

```sh
bun run smoke:deterministic
bun run smoke:live
```

Deterministic mode runs `bun run build`, starts the built production server and
a smoke-only mock provider on random loopback ports, and creates a new
file-backed SQLite database with isolated synthetic configuration, profile,
documents, artifacts, logs, and backups under ignored `tmp/`. The harness validates
migrations and health, every registered tool, audited mutations, upload and
document hydration, conversation resume, and an application restart against
the same database. No Codex credentials are used. This is a local development
and review check; it is not added to GitHub Actions.

Live mode requires an existing local Codex login in `CODEX_HOME` (or the
default `~/.codex`). It refuses a dirty worktree, runs `bun run build`, starts
the built production composition root locally with new synthetic state, and
submits the complete tool registry to the real subscription provider. The
request allows only a normal short response or harmless read-only tool call,
uses at most two model steps and has a default 90-second timeout. It never runs
in GitHub Actions. The subscription endpoint does not accept a client-supplied
output-token limit, so the synthetic prompt requires a brief response and the
hard timeout remains the outer bound. The expected provider use
is one bounded agent request plus the small title request for a new
conversation; normal subscription access rather than API-key billing is used.

Both commands print one bounded JSON result containing the tested revision and
duration. Failures name the phase, revision, correlation ID, tool when known,
and a short reason without printing schemas, document content, prompts, or
credentials. Success, failure, timeout, and interruption stop child processes
and delete the unique temporary state. A commit after either run invalidates
its evidence; developers and independent reviewers must rerun both commands
against the new exact HEAD and record the results in the pull request
smoke-evidence block.

## Initial bootstrap

Create the production directories, then run:

```sh
bin/bootstrap-production.sh
```

This creates the initial isolated production state from the repository-local
private context without changing the development database.

## Deploy

The host deployment script is part of the safety boundary. After a deployment
script change, merge it first and update the local operator checkout to that
exact merge. Inspect that the checkout contains the corrected
`bin/deploy-local.sh` and `bin/sync-production-inputs` before running either
script. Never use an older checkout to deploy the image containing its own
deployment fix; the host script runs before the new container exists.

Set `GIG_FINDER_CODEX_HOME` to the host credential directory and deploy the
exact published merge tag. The script mounts it read-only and sets container
`CODEX_HOME` to `/run/codex`.

```sh
GIG_FINDER_CODEX_HOME=/absolute/codex/home \
  bin/deploy-local.sh sha-<40-character-commit-sha>
```

The script pulls the immutable image, stops runtime writes, verifies registered
artifacts, and creates a matching SQLite-plus-artifact snapshot. It then
synchronizes only explicitly source-managed inputs, migrates and validates the
state, replaces the container, checks `/healthz` for the requested revision,
and validates the state again. On failure it restores the matching database and
artifact snapshot with the prior container. The previous container and recovery
snapshot remain until post-cutover validation succeeds.

The artifact report contains counts only; it does not log document content.
Known missing files are captured as the pre-deployment baseline so the safety
fix can be released while recovery is incomplete. Every later phase must be no
worse than that baseline. New missing, mismatched, unsafe, or unregistered Scout
description paths abort deployment and retain recovery material.

# Deployment runbook

Production runs the Docker image published for a merged commit. The release
model and rollback guarantees are defined by [ADR 0007](decisions/0007-immutable-production-deployment.md).

## Layout

| Purpose | Host path |
| --- | --- |
| Database, profile, and documents | `/var/lib/gig-finder` |
| Configuration | `/etc/gig-finder/config.json` |
| Logs | `/var/log/gig-finder` |
| Backups | `/var/backups/gig-finder` |
| Codex credentials | Operator-selected directory, mounted read-only at `/run/codex` |

The container listens on port `3001`, published only as
`127.0.0.1:3001`. Local development uses dashboard port `5173` and API port
`3101` by default.

## Installed web application

Production includes a web app manifest and a revision-keyed service worker.
Use the browser install action in a current Chromium browser, or Safari's Add
to Home Screen action on iOS or iPadOS. Standalone and ordinary browser launches
use `/` and the same server-side application.

The worker pre-caches only the minimal HTML shell and same-origin,
content-hashed files under `/assets/`. Navigations are network-first and fall
back to that shell when the server cannot be reached. API responses, agent
streams, conversations, documents, uploads, health responses, and all other
user data remain network-only and are never written to a service-worker cache.
The offline shell explains that live data and agent operations require the
server.

Each Docker build injects its Git revision into the client cache name. On
activation, the worker deletes older GigFinder static caches. A running client
checks for a replacement worker, displays a persistent update notice when one
is ready, and reloads only after the user accepts it. This preserves the
immutable-image model: no runtime-generated application asset or mutable state
is added to the image.

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

Set `GIG_FINDER_CODEX_HOME` to the host credential directory and deploy the
exact published merge tag. The script mounts it read-only and sets container
`CODEX_HOME` to `/run/codex`.

```sh
GIG_FINDER_CODEX_HOME=/absolute/codex/home \
  bin/deploy-local.sh sha-<40-character-commit-sha>
```

The script synchronizes private inputs, pulls the Docker image, creates and
verifies a backup, migrates and validates SQLite, replaces the container, and
checks `/healthz` for the requested revision. On failure it restores the backup
and prior container.

## Inspect

Application logs are written to `/var/log/gig-finder/server.log`. The health
endpoint is `http://127.0.0.1:3001/healthz`.

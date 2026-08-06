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

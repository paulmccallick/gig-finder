# ADR 0007: Deploy immutable images with external state and verified rollback

**Status:** Accepted
**Date:** 2026-08-05

## Context

GigFinder holds private mutable state, while each application release must be
traceable to reviewed source and recoverable after migration or startup
failure. Building in production or embedding state in an image weakens both
properties.

## Decision

```mermaid
flowchart LR
  PR[Pull request] -->|validate| CI[GitHub Actions]
  CI -->|main merge SHA| Image[Immutable GHCR image]
  Image -->|deploy exact tag| Host[Local production container]
  Host --> State[/var/lib/gig-finder]
  Host --> Logs[/var/log/gig-finder]
  Host --> Backups[/var/backups/gig-finder]
  Host --> Config[/etc/gig-finder]
  Host -->|read-only| Credentials[Codex credentials]
```

- CI validates a revision, builds its production image once, smoke-tests it
  with synthetic state, and publishes an immutable commit-addressed image.
- Production deploys that exact merge image without rebuilding it locally.
- Databases, documents, configuration, logs, backups, and credentials remain
  outside the image in operator-managed locations.
- Before cutover, deployment creates and verifies a database backup, runs
  migrations with the new image, and requires integrity and foreign-key
  validation.
- The replacement must report healthy at the requested revision before the
  previous container is removed.
- Migration, startup, or health failure restores the backup and prior
  container. Bypassing this verified deployment path is unsupported.

## Consequences

- A running release is attributable to reviewed source and a published image.
- Pull-request validation and release publication share the same build path.
- Private state cannot enter source or build artifacts.
- Database and application rollback remain coupled.
- Deployment depends on image-registry availability and maintained external
  state, backup, and credential directories.

# Infrastructure environments

## Stack

- **Runtime:** Bun and TypeScript.
- **Frontend:** React and Vite, served by the Bun web application in production.
- **Persistence:** File-backed SQLite, Drizzle migrations, and managed local
  document and artifact files.
- **Background work:** Embedded, persisted BunQueue workers.
- **AI:** Vercel AI SDK Core with the Codex subscription provider.
- **Testing:** Bun tests and Playwright browser E2E tests.
- **Packaging:** Docker images published to GitHub Container Registry.
- **Automation:** GitHub Actions for validation, production builds, image smoke
  tests, and publication.

## Development

- **Code:** Runs from the working tree with Bun. The dashboard uses port `5173`
  and the API uses port `3101` by default.
- **Database:** File-backed SQLite under `context/data/`; new installations use
  `context/data/gig-finder.sqlite`.
- **Logs:** Written under `context/logs/`.
- **Context:** Private configuration, profile, artifacts, backups, Scout queue,
  and source settings live under ignored `context/`.
- **Documents:** Managed and profile documents live beneath `context/artifacts/`
  and `context/profile/documents/`.

## Regression

- **Code:** Playwright starts the API from the working tree on port `3002` and
  the dashboard on port `5174`.
- **Database:** A fresh file-backed SQLite database is created at
  `tmp/e2e-context/data/gig-finder.sqlite` for each run.
- **Logs:** Written under `tmp/e2e-context/logs/` with error-level output also
  visible in the test process.
- **Context:** Synthetic, disposable state lives under ignored
  `tmp/e2e-context/` and is recreated at test startup.
- **Documents:** Synthetic document fixtures and generated artifacts live under
  `tmp/e2e-context/artifacts/` and its profile directories. Playwright traces
  and screenshots are written under `test-results/playwright/`.

## GitHub testing

- **Code:** GitHub-hosted Ubuntu runners install frozen dependencies, run checks,
  migrations and browser E2E tests, build the production artifacts, and start a
  production container for smoke verification.
- **Database:** E2E uses the same fresh file-backed regression database. Image
  smoke creates another file-backed database in a runner-temporary directory
  mounted into the container at `/var/lib/gig-finder`.
- **Logs:** Test output is captured by GitHub Actions. Container logs are printed
  when smoke verification fails.
- **Context:** Only synthetic state is created in the runner temporary directory;
  private development and production context is unavailable.
- **Documents:** Synthetic profile and upload fixtures are copied or generated
  in temporary context. No private documents are available to GitHub.

## Production

- **Code:** Runs as one immutable Docker container published for an exact merged
  commit and bound to `127.0.0.1:3001`.
- **Database:** File-backed SQLite in the host directory
  `/var/lib/gig-finder`, mounted into the container.
- **Logs:** Written on the host under `/var/log/gig-finder/`.
- **Context:** Private application state is mounted from `/var/lib/gig-finder`;
  configuration is `/etc/gig-finder/config.json`, backups are under
  `/var/backups/gig-finder`, and Codex credentials are mounted read-only at
  `/run/codex`.
- **Documents:** Runtime artifacts use the dedicated persistent host directory
  `/var/lib/gig-finder/artifacts`, mounted into the
  application container at `/var/lib/gig-finder/artifacts`. Deployment
  maintenance containers do not receive this mount.

Production deployment and recovery procedures are documented in the
[Deployment runbook](deployment-runbook.md).

## Production state ownership

| Path | Owner | Deployment behavior |
| --- | --- | --- |
| `/etc/gig-finder/config.json` | Source-managed private input | Atomically synchronized |
| configured candidate profile | Source-managed private input | Atomically synchronized |
| `data/migration/0010-meeting-participants.json` | Source-managed migration input | Atomically synchronized when present |
| `data/*.sqlite` and queue databases | Runtime | Never synchronized from the repository |
| `/var/lib/gig-finder/artifacts/**` | Runtime | Application-only persistent mount; never inspected, synchronized, backed up, or restored by deployment |
| logs and temporary materializations | Generated | Kept outside source synchronization |

An unclassified path is not a deployable source input. Deployment code uses an
explicit source-input list and must not replace a shared production directory.
Artifact integrity audits and backups are separate operational workflows rather
than deployment steps. Configurable deployment roots must be disjoint from the
canonical artifact root.

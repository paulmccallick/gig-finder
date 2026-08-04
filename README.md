# GigFinder

A local-first opportunity tracker with an interactive dashboard, CLI, and AI
agent that can read current context and update existing gigs and contacts.

## Requirements

- [Bun](https://bun.sh/)
- The Codex CLI, authenticated with `codex login`

## Development

```bash
bun install
bun run dev
```

Open <http://127.0.0.1:5173/>.

Development uses API port `3101`; the production container reserves host port
`3001`.

The web process reads `HOST`, `PORT`, optional `STATIC_ROOT`, and optional
`APP_REVISION`. Local scripts and containers supply those values; the
application has no production or development mode.

Useful checks:

```bash
bun run typecheck
bun test
bun run build
bun run test:e2e
```

## Production

Merges to `main` are validated by `.github/workflows/ci.yml` and published to
`ghcr.io/paulmccallick/gig-finder` as `sha-<merge-sha>`. After the first image
is published, make its GitHub package public once.

Create the standard Unix production directories once, then bootstrap the
database and deployment inputs from `context/`:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" \
  /var/lib/gig-finder \
  /var/log/gig-finder \
  /var/backups/gig-finder \
  /etc/gig-finder
bin/bootstrap-production.sh
```

Deploy a successful merge through OrbStack:

```bash
export GIG_FINDER_CODEX_HOME=/absolute/path/to/codex-home
bin/deploy-local.sh sha-<40-character-merge-sha>
```

The deploy script pulls the immutable image, creates a verified backup, runs
migrations, replaces the container, and rolls back automatically when health
verification fails. Each deployment refreshes the deployed profile,
configuration, and legacy artifacts without replacing the production database.
Application logs remain directly available on the host at
`/var/log/gig-finder/server.log`; container access is not required. Open
<http://127.0.0.1:3001/>.

## Documentation

- [Product overview](docs/product/overview.md)
- [Architecture overview](docs/architecture/overview.md)
- [Architecture boundaries](docs/architecture/boundaries.md)
- [Agent tool contracts](docs/architecture/tool-contracts.md)

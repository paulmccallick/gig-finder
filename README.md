# GigFinder

A local-first opportunity tracker with an interactive dashboard, CLI, and AI
agent over shared job-search records, documents, and workflows.

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

Merges to `main` publish immutable images. Follow the
[deployment runbook](docs/architecture/deployment-runbook.md) to bootstrap,
deploy, verify, inspect, or recover the local production instance.

## Documentation

- [Product overview](docs/product/overview.md)
- [Architecture overview](docs/architecture/overview.md)
- [Configuration](docs/architecture/configuration.md)
- [Deployment runbook](docs/architecture/deployment-runbook.md)

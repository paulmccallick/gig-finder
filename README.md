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

Merges to `main` publish Docker images. Follow the external
[deployment documentation](https://github.com/paulmccallick/gig-finder-spec/blob/main/operations/deployment.md)
to bootstrap, deploy, verify, inspect, or recover the local production instance.

## Documentation

- [GigFinder documentation map](https://github.com/paulmccallick/gig-finder-spec/blob/main/MAP.md)
- [Application overview](https://github.com/paulmccallick/gig-finder-spec/blob/main/APPLICATION.md)
- [Architecture overview](https://github.com/paulmccallick/gig-finder-spec/blob/main/architecture/overview.md)
- [Configuration](https://github.com/paulmccallick/gig-finder-spec/blob/main/operations/deployment.md#configure-runtime-inputs)
- [Deployment](https://github.com/paulmccallick/gig-finder-spec/blob/main/operations/deployment.md)

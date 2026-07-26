# Job Search Agent

A local-first job-search tracker with an interactive dashboard, CLI, and
read-only AI agent.

## Requirements

- [Bun](https://bun.sh/)
- The Codex CLI, authenticated with `codex login`

## Development

```bash
bun install
bun run dev
```

Open <http://127.0.0.1:5173/>.

Useful checks:

```bash
bun run typecheck
bun test
bun run build
bun run test:e2e
```

## Documentation

- [Product overview](docs/product/overview.md)
- [Architecture overview](docs/architecture/overview.md)
- [Architecture boundaries](docs/architecture/boundaries.md)
- [Agent tool contracts](docs/architecture/tool-contracts.md)

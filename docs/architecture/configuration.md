# Configuration

Local development resolves private state beneath `context/`. `config.json`
contains `version: 1`, a non-empty `actor`, and optional relative `profile` and
`profileDocuments` paths.

Environment variables override file configuration:

- Context: `GIG_FINDER_CONTEXT_ROOT`, `GIG_FINDER_CONFIG`,
  `GIG_FINDER_DATABASE`, `GIG_FINDER_PROFILE`,
  `GIG_FINDER_PROFILE_DOCUMENTS`, `GIG_FINDER_ARTIFACTS`,
  `GIG_FINDER_BACKUP_ROOT`, `LOG_DIRECTORY`, and `GIG_FINDER_ACTOR`.
- Server: `HOST`, `PORT`, `STATIC_ROOT`, `APP_REVISION`, and `LOG_LEVEL`.
- Agent: `CODEX_HOME`, `CODEX_AGENT_MODEL`, and `AI_SDK_DEVTOOLS`. The local
  deployment script maps host-side `GIG_FINDER_CODEX_HOME` to container-side
  `CODEX_HOME`.
- Smoke verification: `GIG_FINDER_SMOKE_MODE` is set only by the smoke harness.
  Deterministic mode also supplies its isolated HTTP endpoint through
  `GIG_FINDER_SMOKE_PROVIDER_URL`; the application rejects that endpoint in
  every other mode. These are verification seams, not production provider
  configuration.
- Upload limits: `DOCUMENT_UPLOAD_MAX_BYTES`,
  `DOCUMENT_EXTRACTION_MAX_CHARACTERS`, `DOCUMENT_PDF_MAX_PAGES`,
  `DOCUMENT_DOCX_MAX_UNCOMPRESSED_BYTES`, `DOCUMENT_STAGE_TTL_MS`,
  `DOCUMENT_STAGE_MAX_DOCUMENTS`, and `DOCUMENT_STAGE_MAX_CHARACTERS`.

Paths supplied as environment overrides may be absolute. `profileDocuments` in
`config.json` must remain beneath the context root. Invalid values fail startup.

Gig Scout company/source settings are private immutable database versions, not
application defaults. They own one authoritative source URL, reusable JSON template selection,
and narrowly validated tenant mechanics. The direct `bun run scout:source` troubleshooting
harness reads a private import-format config, requires an ignored output path,
and can select one company/source or an adapter canary set without opening the
application database, web API, or BunQueue.
Scout has two top-level source methods: JSON and DOM HTML. Reusable JSON
configuration templates own public vendor mechanics such as Workday or Greenhouse; unique
JSON configuration supplies paths for a single endpoint schema.
Server-rendered HTML sources use private CSS selectors for the listing surface,
listing nodes, title and detail URL fields, optional metadata, explicit empty
state, and next-page link. Generic JSON sources can select JSON from a
server-returned HTML script envelope before applying the same record paths.
JavaScript-only shells without an official structured feed are unsupported,
not verified empty.
Imports require exactly one active authoritative listing source per company.
Changing that selection appends an immutable configuration version, preserving
historical run references while removing duplicate search, fallback, stale, or
detail-page sources from future runs.

Search terms and locations belong to the private search profile captured with
each run and are passed uniformly to every source. Reusable template definitions
own page size and exhaustion semantics. Runtime policy owns hard request, page,
record, response-size, retry, and duration ceilings. A scan continues until the
source proves exhaustion; reaching a ceiling first produces an explicit
`source_limit_reached` incomplete outcome.

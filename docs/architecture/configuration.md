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
- Upload limits: `DOCUMENT_UPLOAD_MAX_BYTES`,
  `DOCUMENT_EXTRACTION_MAX_CHARACTERS`, `DOCUMENT_PDF_MAX_PAGES`,
  `DOCUMENT_DOCX_MAX_UNCOMPRESSED_BYTES`, `DOCUMENT_STAGE_TTL_MS`,
  `DOCUMENT_STAGE_MAX_DOCUMENTS`, and `DOCUMENT_STAGE_MAX_CHARACTERS`.

Paths supplied as environment overrides may be absolute. `profileDocuments` in
`config.json` must remain beneath the context root. Invalid values fail startup.

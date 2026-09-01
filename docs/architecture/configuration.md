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

Configured JSON description fields resolve `contentFormat` to `auto` and
`contentEncoding` to `none` when omitted. `contentFormat` may instead be
`html` or `plain-text`; `contentEncoding` may be `html-entities`, but only with
the `html` format. The canonical converter decodes declared entity-encoded HTML
before producing Markdown and records its immutable converter identity while
retaining only bounded hashes and acquisition provenance for source content.
Artifact and normalized-description identities may deduplicate identical
Markdown, but each explicit reacquisition persists its own processing-bound
provenance. Any promoted managed-document projection therefore cites the exact
official URL, retrieval time, hashes, configuration, extraction strategy, and
converter used by that acquisition rather than provenance from a shared
artifact.
Direct HTML detail responses continue to use their authoritative HTTP media
type and therefore resolve as HTML with no configured entity decoding.

Reusable template artifacts are immutable by ID and version. A company inherits
description format, encoding, extraction, and request mechanics from the exact
template version selected by its immutable configuration. Company variables and
the validated string override map may fill template-declared tenant values, but
cannot replace structural description semantics. A company-specific structural
exception requires a new template version or an explicit custom JSON source.
Greenhouse v3 declares both listing and detail descriptions as `html` with
`html-entities`; Greenhouse v1 and v2 retain their original artifacts and resolve
the backward-compatible `auto`/`none` defaults.

Search terms and locations belong to the private search profile captured with
each run and are passed uniformly to every source. Reusable template definitions
own page size and exhaustion semantics. Runtime policy owns hard request, page,
record, response-size, retry, and duration ceilings. A scan continues until the
source proves exhaustion; reaching a ceiling first produces an explicit
`source_limit_reached` incomplete outcome.

As a temporary application-level exception, a full Scout run resolves an
omitted or empty title-term dimension to Director, Senior Director, Sr.
Director, Senior Vice President, SVP, Vice President, VP Engineering, Head of
Engineering, and Head of Technology. It resolves an omitted or empty location
dimension to Seattle, Bellevue, Redmond, Remote, and Washington. A non-empty
explicit dimension replaces its defaults. Scout persists the resolved profile
as the run's immutable snapshot and dispatches it uniformly. Each dispatched
run-company also snapshots the configured company display name so recovery and
reviewed promotion keep the original observation context if the company is
renamed later. These snapshots do not alter company configurations, source
selection, or reusable templates.

After JSON or DOM normalization, the common sourcing validation path applies
the captured profile to structured title and location data. Optional
`titleVariants` group a configured term with equivalent forms; the defaults
map Vice President to VP and Senior Vice President to SVP. Title matching uses
normalized contiguous token sequences and boundaries rather than arbitrary
substrings. A position preserves its source display location, every
authoritative location with an explicit remote, hybrid, or on-site arrangement,
and its overall arrangement. Any authoritative location or arrangement may
satisfy the location dimension. Remote, Work at Home, Work from Home, and
home-based labels are remote; a country label alone never implies remote.
Aggregate-only labels such as `N Locations` defer source filtering when their
underlying locations are unavailable. Workday v3 resolves those collections
from a bounded official detail request before filtering when possible.
Nonmatching candidates remain evaluated rejections with title, location, or
both diagnostics and the normalized decision inputs so reconciliation stays
balanced. Template-side search parameters remain acquisition optimizations,
not the enforcement boundary.

Explicit position reprocessing is an operator-authorized, exact-ID workflow. A
preview validates the reviewed position IDs without creating work. Start binds
each accepted position to its current authoritative observation and the active
immutable company/source configuration, snapshots the current screening inputs,
and records the operator reason. Every new reconciliation, description,
relevance, and candidate-match record is run-bound; completed prior records are
not reset or edited. Preview rejects a position when its active configuration
has no exact-position detail acquisition plan or when that plan requires an
external-ID identity check but the stored position has no nonblank external ID;
neither a listing-only source nor a detail plan guaranteed to fail identity
verification is treated as an authoritative reacquisition capability. An explicit
full rerun intentionally reevaluates relevance and eligible candidate match even
when the normalized Markdown identity deduplicates. Queue messages remain the minimal `{ processingId }`
transport payload, and durable database work owns all other identity and input
material.

Successful rerun stages replace only their current projections. Linked promoted
positions continue through acquisition rather than terminating at reconciliation.
Core position processing owns the managed-document update through the existing
managed-document service: it updates the exact existing Gig job-description
document, appends immutable source provenance and a new version only when
content changes, and never writes managed-document tables directly from Scout
persistence.

Reviewed position promotion follows the same boundary. Scout persistence stores
each reviewed resolution as an immutable attempt, while the core position service
coordinates the Gig domain and managed-document service. A stale or invalid
resolution after intent is terminalized through the Scout persistence port and
released back to review; infrastructure failures keep the attempt retryable.
New job-description documents store the reviewed structured provenance on
version 1. When normalized Markdown is unchanged, Scout creates no
provenance-only version and retains the existing immutable version's historical
provenance.

Explicit position-backfill items also own durable terminal reporting. Their
bounded snapshots retain company and template context plus normalized-description,
workflow, promoted-document, and failure outcomes without retaining source
content. Completion of every accepted item terminalizes the run as `completed`,
`partial`, or `failed`; a later run may explicitly supersede unfinished work,
which also terminalizes the earlier run rather than leaving it perpetually
running.

Ordinary application deployment, startup, and migration do not select positions
or preview, start, or resume an explicit backfill. Upgrading a production company
to Greenhouse v3 or another configuration version is a separate
operator-authorized configuration change. Selecting exact production position
IDs and starting their backfill is a later, separately reviewed operator action.

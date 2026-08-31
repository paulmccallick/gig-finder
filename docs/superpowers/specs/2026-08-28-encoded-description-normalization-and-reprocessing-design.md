# Encoded Description Normalization and Position Reprocessing

**Issue:** [#143 — Normalize entity-encoded HTML job descriptions](https://github.com/paulmccallick/gig-finder/issues/143)

## Problem

Some configured job sources return description fields containing entity-encoded HTML. The current converter recognizes literal HTML only, so values such as `&lt;div&gt;` are stored as malformed Markdown and passed unchanged to Scout screening.

The correction must fix future acquisition and safely reprocess affected current work. Reprocessing must be general enough to rerun positions after future template, converter, prompt, model, or processing defects rather than introducing an issue-specific repair path.

## Scope

This change will:

- make description encoding an immutable template/configuration concern;
- introduce a new converter version for decoded HTML-to-Markdown output;
- store only normalized Markdown as the position description artifact;
- generalize backfill to rerun explicit position IDs through the complete position process;
- preserve immutable processing, description, evaluation, decision, and managed-document history;
- continue processing linked positions instead of terminating at Gig reconciliation; and
- update the existing managed job-description document for a promoted Gig when its position description changes.

The #143 production backfill will include affected positions currently requiring user review, affected positions marked irrelevant by the agent, and affected promoted positions. Positions explicitly marked irrelevant or rejected by the user are excluded. No deferred-specific behavior is introduced.

## Configured conversion

JSON description extraction definitions gain content-format and content-encoding settings with backward-compatible defaults. `contentFormat` is `auto`, `html`, or `plain-text` and defaults to `auto`, preserving the current literal-tag detection. `contentEncoding` is `none` or `html-entities` and defaults to `none`. `html-entities` is valid only with `contentFormat: html`. The Greenhouse template declares entity-encoded HTML. Company configurations inherit that immutable template behavior by selecting the template version; the existing string override map does not alter structural description semantics. A genuine company-specific exception requires a separate immutable template version or an explicit custom JSON source definition.

At runtime, the canonical converter performs these steps:

1. Accept the extracted description value and its configured format/encoding semantics.
2. Decode HTML entities only when configuration declares entity-encoded HTML.
3. Decode to a maximum documented depth of two passes, stopping when a pass makes no change.
4. Convert the decoded value through Turndown when `contentFormat` is `html`, preserve it as text when `contentFormat` is `plain-text`, or apply the existing literal-tag detection when it is `auto`.
5. Enforce the existing normalized-description size policy.
6. Identify the result with a new immutable converter version.

Existing JSON descriptions that omit both settings preserve today's inference and no-decoding behavior through the defaults. Plain text and literal encoded examples are not decoded unless their source configuration explicitly declares entity-encoded HTML. Direct HTTP description responses continue to use their authoritative HTTP media type and do not require a JSON-field format declaration.

The raw or encoded description is not stored. Acquisition retains only bounded provenance such as the official URL, retrieval time, source-content hash, template/configuration identity, extraction strategy, and converter version. The file artifact contains readable normalized Markdown.

## Generic position backfill

The existing position-backfill capability is generalized to accept an explicit bounded set of position IDs and an operator reason. Existing source-run backfill behavior remains compatible.

A preview step selects candidate IDs without creating work. Execution receives the reviewed exact IDs, preventing selection drift between review and mutation. Each execution creates a durable backfill run and new immutable processing rows; it never resets, deletes, or edits completed historical rows.

Every selected position is rerun from the beginning:

1. Reconcile the position with active Gigs.
2. Refetch the official description using the latest authoritative observation and current active source/template configuration.
3. Normalize and persist a new description identity when content or converter identity changes.
4. Run relevance screening.
5. Run candidate scoring when the relevance result permits it.
6. Project the newest successful results as current.

The queue job continues to carry only its durable processing ID. The database-bound work records the run, position, observation, current configuration, operator reason, and processing identity.

Backfill always refetches the official description. It does not take the ordinary existing-description reuse shortcut. Reconciliation records or confirms a linked Gig but does not terminate the backfill pipeline.

## State and Gig behavior

Prior successful projections remain current until their replacement stage succeeds. A failed attempt is retained with its failure details and can be retried without losing the last usable description or evaluation.

- A position awaiting review remains reviewable with a new state revision after successful reevaluation. Stale open reviews are rejected by the existing revision contract.
- An agent-irrelevant position that remains irrelevant receives a new audited agent decision based on the new description/evaluation identities.
- An agent-irrelevant position that becomes relevant moves to `needs_user_review` with its new score and explanation.
- A promoted position remains promoted and excluded from the review workspace.

For a promoted position, successful description acquisition updates the Gig through core services. The existing linked `job_description` managed document receives a new immutable version containing the exact normalized Markdown and provenance. Backfill must not create a second Gig, a second job-description document, or direct data-layer document writes. Unchanged normalized content produces no duplicate document version.

## Idempotency and reporting

The execution identity includes the explicit position set, operator reason, current configuration identity, and processing inputs. Retrying the same execution reuses durable work. It cannot duplicate source requests within one attempt, position descriptions, evaluations, agent decisions, managed documents, document versions, or model work for unchanged identities.

Backfill status reports:

- requested, accepted, and rejected position IDs;
- pending, completed, failed, and superseded counts for every stage;
- final position outcomes, including agent-irrelevant-to-review transitions;
- promoted-Gig document outcomes; and
- bounded company/template/failure information without description content.

## Verification and rollout

Deterministic coverage includes default-auto JSON plain text, default-auto JSON literal HTML, explicit plain text, explicit literal HTML, configured single- and double-entity-encoded JSON HTML, literal entity examples that must remain text, raw/encoded HTML equivalence, direct HTML response handling, invalid format/encoding combinations, converter identity, template inheritance, immutable reruns, current-projection replacement, retry idempotency, linked-Gig continuation, agent-irrelevant reevaluation, and managed-document versioning through core services.

HTTP coverage verifies explicit IDs, operator reason, validation, bounded batch size, preview behavior, and stable status. A full synthetic Scout flow covers malformed acquisition through corrected review or promoted-Gig document update. A bounded read-only live lane uses ignored private canary configuration to verify multiple current official sites: Greenhouse entity-encoded HTML, a JSON source returning literal HTML, and a JSON source exercising the default/plain behavior. It also verifies a direct HTML response path when an active configured canary exists. Deterministic tests, rather than provider availability, cover the complete semantic matrix. The lane reports only company/source, template/version, resolved format/encoding, extraction strategy, converter version, outcome, failure code, and duration; it never stores or emits description content.

Rollout is deliberately two-phase:

1. Deploy and verify the converter, template, and generic backfill behavior.
2. Produce a read-only production selection report, approve its exact position IDs, submit them to backfill, monitor durable completion, and verify position and Gig outcomes.

No migration, application startup, or deployment step initiates external description requests or model calls.

## Documentation impact

Update product documentation for description normalization and review revisions. Update architecture/configuration documentation for template-owned content encoding and explicit-ID durable backfill. No new ADR is required because the design extends the established position-processing boundary, managed-document lifecycle, and domain-service ownership decisions.

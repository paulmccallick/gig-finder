import {
  postingResolutionSchema,
  type GigPostingCandidate,
  type PostingCandidateResolution,
  type PostingResolution,
} from "../../gigs";
import type {
  DocumentSummary,
  ManagedDocumentRecord,
  ManagedDocumentSourceProvenance,
  ManagedDocumentVersionData,
} from "../../documents";
import type { ManagedDocumentService } from "../../managed-document-service";
import type { GigDomainService } from "../../tracker-services";
import type {
  ScoutPositionBackfillCommand,
  ScoutPositionDetail,
  ScoutPostingResolutionStore,
  ScoutPromotionWork,
  ScoutUserDecisionCommand,
} from "./positions";

const exactPositionIdPattern = /^spos_[0-9a-f]{32}$/;

export type ScoutPursueResult =
  | { status: "created" | "updated"; position: ScoutPositionDetail | null }
  | { status: "resolution_required" | "resolution_stale"; fingerprint: string; candidates: GigPostingCandidate[] }
  | { status: "resolution_invalid" };

type ScoutDecisionInput = Omit<ScoutUserDecisionCommand, "positionId"> & {
  resolution?: PostingResolution;
};

function normalizeBackfillCommand(input: unknown): ScoutPositionBackfillCommand {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Scout position backfill request must be an object.");
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "positionIds" || keys[1] !== "reason") {
    throw new Error("Scout position backfill accepts only positionIds and reason.");
  }
  if (!Array.isArray(record.positionIds)) {
    throw new Error("Scout position backfill requires between 1 and 1,000 exact position IDs.");
  }
  const validatedPositionIds: string[] = [];
  for (const positionId of record.positionIds) {
    if (typeof positionId !== "string" || !exactPositionIdPattern.test(positionId)) {
      throw new Error("Scout position backfill contains a malformed position ID.");
    }
    validatedPositionIds.push(positionId);
  }

  const positionIds = [...new Set(validatedPositionIds)].sort();
  if (positionIds.length < 1 || positionIds.length > 1000) {
    throw new Error("Scout position backfill requires between 1 and 1,000 exact position IDs.");
  }

  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (reason.length < 1 || reason.length > 500) {
    throw new Error("Scout position backfill reason must contain between 1 and 500 characters.");
  }
  return { positionIds, reason };
}

export class ScoutPositionService {
  constructor(
    private readonly store: ScoutPostingResolutionStore,
    private readonly gigs: Pick<GigDomainService, "resolvePosting" | "acceptPosting">,
    private readonly documents: Pick<ManagedDocumentService, "get" | "create" | "update" | "createdByChange" | "versionByChange">,
  ) {}

  list(input: Partial<{ text: string; company: string; state: string; sort: string; direction: "asc" | "desc"; offset: number; limit: number }> = {}) {
    this.store.resurfaceDue(new Date().toISOString());
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 20;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid Scout position pagination.");
    const state = input.state ?? "needs_user_review";
    if (!["actionable", "processing", "needs_user_review", "deferred"].includes(state)) throw new Error("Invalid Scout position state filter.");
    const sort = input.sort ?? "last_seen";
    if (!["last_seen", "first_seen", "company", "title", "state", "score"].includes(sort)) throw new Error("Invalid Scout position sort.");
    const direction = input.direction ?? "desc";
    if (direction !== "asc" && direction !== "desc") throw new Error("Invalid Scout position sort direction.");
    return this.store.workspace({ text: input.text?.trim().slice(0, 200), company: input.company?.trim().slice(0, 200), state, sort, direction, offset, limit });
  }

  get(id: string) { return this.store.reviewDetail?.(id) ?? this.store.positionDetail(id); }

  decide(positionId: string, input: ScoutDecisionInput): ScoutPositionDetail | ScoutPursueResult {
    if (!input.changeId?.trim() || !input.actor?.trim()) {
      throw new Error("Decision change ID and actor are required.");
    }
    if (input.note !== undefined && (input.note.trim().length < 1 || input.note.length > 2000)) {
      throw new Error("Decision note must contain 1 to 2000 characters.");
    }
    if (input.action === "defer" && (!input.reviewAt || Number.isNaN(Date.parse(input.reviewAt)))) {
      throw new Error("Defer requires a valid reviewAt timestamp.");
    }
    const now = new Date().toISOString();
    const { resolution, ...decisionInput } = input;
    const command: ScoutUserDecisionCommand = {
      ...decisionInput,
      positionId,
      changeId: input.changeId.trim(),
      actor: input.actor.trim(),
      note: input.note?.trim(),
    };
    if (input.action !== "pursue") return this.store.decide(command, now);

    const review = this.store.reviewPosting(positionId);
    if (
      !review
      || review.detail.stateRevision !== command.expectedStateRevision
      || review.detail.descriptionId !== command.descriptionId
      || review.detail.relevanceEvaluationId !== command.relevanceEvaluationId
      || review.detail.candidateMatchEvaluationId !== command.candidateMatchEvaluationId
    ) {
      throw new Error("This position was revised and requires review again.");
    }
    const parsedResolution = resolution === undefined ? undefined : postingResolutionSchema.parse(resolution);
    const candidates = this.gigs.resolvePosting(review.posting);
    const stableResolution = this.validateResolution(candidates, parsedResolution);
    if (stableResolution) return stableResolution;
    const reviewedResolution = parsedResolution ?? { kind: "create_new", reviewedFingerprint: candidates.fingerprint };
    const work = this.store.beginPursue(command, reviewedResolution, now);
    return this.promote(work, now);
  }

  restore(positionId: string, input: { changeId: string; actor: string; expectedStateRevision: number }) { return this.store.restoreAgentIrrelevant({ ...input, positionId }, new Date().toISOString()); }
  reverse(positionId: string, input: { decisionId: string; changeId: string; actor: string; expectedStateRevision: number }) { return this.store.reverseDecision({ ...input, positionId }, new Date().toISOString()); }
  addNote(positionId: string, input: { decisionId?: string; actor: string; body: string }) { const body = input.body?.trim(); if (!body || body.length > 2000) throw new Error("Position note must contain 1 to 2000 characters."); this.store.appendPositionNote({ ...input, positionId, body }, new Date().toISOString()); return { ok: true }; }
  retryPromotion(positionId: string): ScoutPursueResult | null {
    const work = this.store.promotionWork(positionId);
    return work ? this.promote(work, new Date().toISOString()) : null;
  }
  relevance() { return this.store.relevanceCriteria(); }
  configureRelevance(input: { criteria: unknown; confidenceThreshold: unknown }) { if (typeof input.criteria !== "string" || input.criteria.trim().length < 10 || input.criteria.length > 4_000) throw new Error("Relevance criteria must contain 10 to 4000 characters."); if (typeof input.confidenceThreshold !== "number" || input.confidenceThreshold < 0 || input.confidenceThreshold > 1) throw new Error("Relevance confidence threshold must be from 0 through 1."); return this.store.appendRelevanceCriteria(input.criteria.trim(), input.confidenceThreshold, new Date().toISOString()); }
  backfill(sourceRunId: string, limit = 100) { if (!sourceRunId.trim()) throw new Error("A source Scout run ID is required."); if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Backfill limit must be from 1 through 1000."); return this.store.backfillPositions(sourceRunId.trim(), limit, new Date().toISOString()); }
  previewBackfill(input: unknown) {
    return this.store.previewBackfill(normalizeBackfillCommand(input));
  }

  startBackfill(input: unknown) {
    return this.store.startBackfill(
      normalizeBackfillCommand(input),
      new Date().toISOString(),
    );
  }

  backfillStatus(runId: string) {
    const normalized = runId.trim();
    if (!/^srun_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
      throw new Error("A valid Scout position backfill run ID is required.");
    }
    return this.store.backfillStatus(normalized);
  }

  private validateResolution(
    current: PostingCandidateResolution,
    resolution?: PostingResolution,
  ): Exclude<ScoutPursueResult, { status: "created" | "updated" }> | null {
    if (!resolution) {
      return current.candidates.length > 0
        ? { status: "resolution_required", ...current }
        : null;
    }
    if (resolution.reviewedFingerprint !== current.fingerprint) {
      return { status: "resolution_stale", ...current };
    }
    if (resolution.kind === "create_new") return null;
    const selected = current.candidates.find(candidate => candidate.gigId === resolution.gigId);
    if (!selected) return { status: "resolution_invalid" };
    return selected.revision === resolution.expectedGigRevision
      ? null
      : { status: "resolution_stale", ...current };
  }

  private promote(work: ScoutPromotionWork, now: string): ScoutPursueResult {
    try {
      const accepted = this.gigs.acceptPosting(
        {
          actor: work.actor,
          source: "automation",
          summary: "Promote reviewed Scout posting",
          changeId: `${work.changeId}:gig`,
          occurredAt: now,
        },
        work.posting,
        work.resolution,
      );
      if (accepted.status !== "created" && accepted.status !== "updated") return accepted;
      const document = this.coordinateDocument(work, accepted.gig.id, accepted.gig.documents, now);
      this.store.completePromotion(work.positionId, accepted.gig.id, document.id, now);
      return {
        status: accepted.status,
        position: this.store.reviewDetail?.(work.positionId)
          ?? this.store.positionDetail(work.positionId),
      };
    } catch (reason) {
      this.store.failPromotion(
        work.positionId,
        reason instanceof Error ? reason.message : "Promotion failed.",
        now,
      );
      throw reason;
    }
  }

  private coordinateDocument(
    work: ScoutPromotionWork,
    gigId: string,
    summaries: DocumentSummary[],
    now: string,
  ): ManagedDocumentRecord {
    const changeId = `${work.changeId}:document`;
    const expectedTitle = `${work.posting.company} — ${work.posting.title}`;
    const created = this.documents.createdByChange(changeId);
    if (created) {
      this.verifyDocument(created, gigId, expectedTitle, work.markdown, work.sourceDescription);
      return created;
    }
    const summary = summaries
      .filter(document => document.type === "job_description")
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (!summary) {
      const document = this.documents.create(
        {
          actor: work.actor,
          source: "automation",
          summary: "Create reviewed Scout job description",
          changeId,
          occurredAt: now,
        },
        {
          links: [{ entityType: "gig", entityId: gigId }],
          documentType: "job_description",
          title: expectedTitle,
          mediaType: "text/markdown",
          sourceDescription: work.sourceDescription,
          content: work.markdown,
          uploadProvenance: null,
        },
      ).document;
      this.verifyDocument(document, gigId, expectedTitle, work.markdown, work.sourceDescription);
      return document;
    }

    const current = this.documents.get(summary.id);
    if (!current) throw new Error("Reviewed Scout Gig job description is unavailable.");
    this.verifyDocumentIdentity(current, gigId, expectedTitle);
    const replayedVersion = this.documents.versionByChange(changeId);
    if (replayedVersion) return this.reconcileVersion(current.id, replayedVersion, work, gigId, expectedTitle);
    if (current.content === work.markdown) {
      if (current.sourceDescription !== work.sourceDescription) {
        throw new Error("Reviewed Scout document replay does not match the persisted promotion.");
      }
      return current;
    }

    try {
      this.documents.update(
        {
          actor: work.actor,
          source: "automation",
          summary: "Update reviewed Scout job description",
          changeId,
          occurredAt: now,
        },
        {
          documentId: current.id,
          expectedVersion: current.currentVersion,
          content: work.markdown,
          changeSummary: "Update from reviewed official Scout posting",
          sourceDescription: work.sourceDescription,
          sourceProvenance: work.sourceProvenance,
        },
      );
    } catch (reason) {
      const reconciled = this.documents.versionByChange(changeId);
      if (!reconciled) throw reason;
      return this.reconcileVersion(current.id, reconciled, work, gigId, expectedTitle);
    }
    const version = this.documents.versionByChange(changeId);
    if (!version) throw new Error("Reviewed Scout document version could not be verified.");
    return this.reconcileVersion(current.id, version, work, gigId, expectedTitle);
  }

  private reconcileVersion(
    documentId: string,
    version: ManagedDocumentVersionData,
    work: ScoutPromotionWork,
    gigId: string,
    expectedTitle: string,
  ) {
    this.verifyVersion(version, documentId, work.markdown, work.sourceDescription, work.sourceProvenance);
    const document = this.documents.get(documentId);
    if (!document || document.currentVersion !== version.version) {
      throw new Error("Reviewed Scout document version is not current.");
    }
    this.verifyDocumentIdentity(document, gigId, expectedTitle);
    if (document.content !== work.markdown) throw new Error("Reviewed Scout document replay does not match the persisted promotion.");
    return document;
  }

  private verifyDocument(
    document: ManagedDocumentRecord,
    gigId: string,
    expectedTitle: string,
    expectedContent: string,
    expectedSource: string,
  ) {
    this.verifyDocumentIdentity(document, gigId, expectedTitle);
    if (document.content !== expectedContent || document.sourceDescription !== expectedSource) {
      throw new Error("Reviewed Scout document replay does not match the persisted promotion.");
    }
  }

  private verifyDocumentIdentity(document: ManagedDocumentRecord, gigId: string, expectedTitle: string) {
    const exactGigOwnership = document.links.length === 1
      && document.links[0]?.entityType === "gig"
      && document.links[0].entityId === gigId;
    if (
      document.documentType !== "job_description"
      || document.title !== expectedTitle
      || document.mediaType !== "text/markdown"
      || !exactGigOwnership
    ) {
      throw new Error("Reviewed Scout document replay does not match the persisted promotion.");
    }
  }

  private verifyVersion(
    version: ManagedDocumentVersionData,
    documentId: string,
    expectedContent: string,
    expectedSource: string,
    expectedProvenance: ManagedDocumentSourceProvenance,
  ) {
    const actual = version.sourceProvenance;
    const exactProvenance = actual?.officialUrl === expectedProvenance.officialUrl
      && actual.retrievedAt === expectedProvenance.retrievedAt
      && actual.sourceContentHash === expectedProvenance.sourceContentHash
      && actual.extractedContentHash === expectedProvenance.extractedContentHash
      && actual.sourceKey === expectedProvenance.sourceKey
      && actual.configurationVersion === expectedProvenance.configurationVersion
      && actual.extractionStrategy === expectedProvenance.extractionStrategy
      && actual.converterVersion === expectedProvenance.converterVersion;
    if (
      version.documentId !== documentId
      || version.content !== expectedContent
      || version.sourceDescription !== expectedSource
      || !exactProvenance
    ) {
      throw new Error("Reviewed Scout document version does not match the persisted promotion.");
    }
  }
}

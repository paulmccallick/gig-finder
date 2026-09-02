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
import { createHash } from "node:crypto";
import { MutationError } from "../../errors";
import type { ManagedDocumentService } from "../../managed-document-service";
import type { GigDomainService } from "../../gig-domain-service";
import type {
  ScoutPositionBackfillCommand,
  ScoutPositionDetail,
  ScoutPostingResolutionStore,
  ScoutPromotionMaterial,
  ScoutUserDecisionCommand,
} from "./positions";

const exactPositionIdPattern = /^spos_[0-9a-f]{32}$/;

export type ScoutPursueResult =
  | { status: "created" | "updated"; position: ScoutPositionDetail | null }
  | { status: "resolution_required"; fingerprint: string; candidates: GigPostingCandidate[] }
  | { status: "resolution_stale"; fingerprint: string; candidates: GigPostingCandidate[]; position: ScoutPositionDetail }
  | { status: "resolution_invalid"; position: ScoutPositionDetail };

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

  get(id: string) {
    const position = this.store.reviewDetail?.(id) ?? this.store.positionDetail(id);
    return position?.state === "promoted" ? null : position;
  }

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
    const stableResolution = this.validateResolution(candidates, review.detail, parsedResolution);
    if (stableResolution) return stableResolution;
    const reviewedResolution = parsedResolution ?? { kind: "create_new", reviewedFingerprint: candidates.fingerprint };
    const work = this.store.beginPursue(command, reviewedResolution, now);
    if (work.kind !== "attempt") {
      throw new Error("Reviewed Scout promotion intent is unavailable.");
    }
    return this.applyPromotion(
      work,
      work.resolution,
      work.changeId,
      "record_attempt",
      now,
    );
  }

  restore(positionId: string, input: { changeId: string; actor: string; expectedStateRevision: number }) { return this.store.restoreAgentIrrelevant({ ...input, positionId }, new Date().toISOString()); }
  reverse(positionId: string, input: { decisionId: string; changeId: string; actor: string; expectedStateRevision: number }) { return this.store.reverseDecision({ ...input, positionId }, new Date().toISOString()); }
  addNote(positionId: string, input: { decisionId?: string; actor: string; body: string }) { const body = input.body?.trim(); if (!body || body.length > 2000) throw new Error("Position note must contain 1 to 2000 characters."); this.store.appendPositionNote({ ...input, positionId, body }, new Date().toISOString()); return { ok: true }; }
  retryPromotion(positionId: string): ScoutPursueResult | null {
    const work = this.store.promotionWork(positionId);
    if (!work) return null;
    const now = new Date().toISOString();
    if (work.kind === "attempt") {
      return this.applyPromotion(
        work,
        work.resolution,
        work.changeId,
        "record_attempt",
        now,
      );
    }

    const current = this.gigs.resolvePosting(work.posting);
    const linked = current.candidates.find(
      candidate => candidate.gigId === work.linkedGigId,
    );
    if (!linked || linked.stage === "closed") {
      return {
        status: "resolution_invalid",
        position: this.completedPosition(work.positionId),
      };
    }
    const resolution: PostingResolution = {
      kind: "use_existing",
      reviewedFingerprint: current.fingerprint,
      gigId: linked.gigId,
      expectedGigRevision: linked.revision,
    };
    const retryChangeId = `scout-promotion-retry:${createHash("sha256")
      .update([
        work.positionId,
        work.linkedGigId,
        work.observationId,
        work.descriptionId,
      ].join("\0"))
      .digest("hex")}`;
    return this.applyPromotion(
      work,
      resolution,
      retryChangeId,
      "completed_retry",
      now,
    );
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
    position: ScoutPositionDetail,
    resolution?: PostingResolution,
  ): Exclude<ScoutPursueResult, { status: "created" | "updated" }> | null {
    if (!resolution) {
      return current.candidates.length > 0
        ? { status: "resolution_required", ...current }
        : null;
    }
    if (resolution.reviewedFingerprint !== current.fingerprint) {
      return { status: "resolution_stale", ...current, position };
    }
    if (resolution.kind === "create_new") return null;
    const selected = current.candidates.find(candidate => candidate.gigId === resolution.gigId);
    if (!selected) return { status: "resolution_invalid", position };
    return selected.revision === resolution.expectedGigRevision
      ? null
      : { status: "resolution_stale", ...current, position };
  }

  private applyPromotion(
    work: ScoutPromotionMaterial,
    resolution: PostingResolution,
    changeId: string,
    completion: "record_attempt" | "completed_retry",
    now: string,
  ): ScoutPursueResult {
    try {
      let acceptedStatus: "created" | "updated";
      let acceptedGig: { id: string; documents: DocumentSummary[] };
      try {
        const accepted = this.gigs.acceptPosting(
          {
            actor: work.actor,
            source: "automation",
            summary: completion === "completed_retry"
              ? "Retry completed Scout promotion"
              : "Promote reviewed Scout posting",
            changeId: `${changeId}:gig`,
            occurredAt: now,
          },
          work.posting,
          resolution,
        );
        if (accepted.status === "resolution_stale" || accepted.status === "resolution_invalid") {
          const position = completion === "record_attempt"
            ? this.store.releasePromotion(work.positionId, changeId, accepted.status, now)
            : this.completedPosition(work.positionId);
          return { ...accepted, position };
        }
        if (accepted.status !== "created" && accepted.status !== "updated") return accepted;
        acceptedStatus = accepted.status;
        acceptedGig = accepted.gig;
      } catch (reason) {
        if (
          completion !== "completed_retry"
          || !(reason instanceof MutationError)
          || reason.code !== "duplicate_change"
          || resolution.kind !== "use_existing"
        ) {
          throw reason;
        }
        const replay = this.gigs.resolvePosting(work.posting);
        const linked = replay.candidates.find(
          candidate => candidate.gigId === resolution.gigId,
        );
        if (!linked || linked.stage === "closed") {
          return {
            status: "resolution_invalid",
            position: this.completedPosition(work.positionId),
          };
        }
        const expectedExternalId = work.posting.externalId?.trim();
        const expectedLocation = work.posting.location?.trim();
        const committedPostingMatches = linked.title === work.posting.title
          && linked.sourceUrl === work.posting.canonicalUrl
          && (!expectedExternalId || linked.externalJobId === expectedExternalId)
          && (!expectedLocation || linked.location === expectedLocation);
        if (!committedPostingMatches) throw reason;
        acceptedStatus = "updated";
        acceptedGig = {
          id: linked.gigId,
          documents: linked.jobDescription ? [linked.jobDescription] : [],
        };
      }
      const document = this.coordinateDocument(
        work,
        changeId,
        acceptedGig.id,
        acceptedGig.documents,
        now,
      );
      if (completion === "record_attempt") {
        this.store.completePromotion(work.positionId, acceptedGig.id, document.id, now);
      }
      return {
        status: acceptedStatus,
        position: completion === "completed_retry"
          ? this.completedPosition(work.positionId)
          : null,
      };
    } catch (reason) {
      if (completion === "record_attempt") {
        this.store.failPromotion(
          work.positionId,
          reason instanceof Error ? reason.message : "Promotion failed.",
          now,
        );
      }
      throw reason;
    }
  }

  private completedPosition(positionId: string): ScoutPositionDetail {
    const position = this.store.positionDetail(positionId);
    if (!position || position.state !== "promoted") {
      throw new Error("Completed Scout promotion position is unavailable.");
    }
    return position;
  }

  private coordinateDocument(
    work: ScoutPromotionMaterial,
    promotionChangeId: string,
    gigId: string,
    summaries: DocumentSummary[],
    now: string,
  ): ManagedDocumentRecord {
    const changeId = `${promotionChangeId}:document`;
    const expectedTitle = `${work.posting.company} — ${work.posting.title}`;
    const created = this.documents.createdByChange(changeId);
    if (created) {
      return this.reconcileCreatedDocument(created, changeId, work, gigId, expectedTitle);
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
          sourceProvenance: work.sourceProvenance,
          content: work.markdown,
          uploadProvenance: null,
        },
      ).document;
      return this.reconcileCreatedDocument(document, changeId, work, gigId, expectedTitle);
    }

    const current = this.documents.get(summary.id);
    if (!current) throw new Error("Reviewed Scout Gig job description is unavailable.");
    this.verifyDocumentIdentity(current, gigId);
    const replayedVersion = this.documents.versionByChange(changeId);
    if (replayedVersion) return this.reconcileVersion(current.id, replayedVersion, work, gigId);
    if (current.content === work.markdown) {
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
      return this.reconcileVersion(current.id, reconciled, work, gigId);
    }
    const version = this.documents.versionByChange(changeId);
    if (!version) throw new Error("Reviewed Scout document version could not be verified.");
    return this.reconcileVersion(current.id, version, work, gigId);
  }

  private reconcileCreatedDocument(
    document: ManagedDocumentRecord,
    changeId: string,
    work: ScoutPromotionMaterial,
    gigId: string,
    expectedTitle: string,
  ) {
    this.verifyDocument(document, gigId, expectedTitle, work.markdown, work.sourceDescription);
    const version = this.documents.versionByChange(changeId);
    if (!version || version.version !== 1 || document.currentVersion !== 1) {
      throw new Error("Reviewed Scout document version could not be verified.");
    }
    this.verifyVersion(version, document.id, work.markdown, work.sourceDescription, work.sourceProvenance);
    return document;
  }

  private reconcileVersion(
    documentId: string,
    version: ManagedDocumentVersionData,
    work: ScoutPromotionMaterial,
    gigId: string,
  ) {
    this.verifyVersion(version, documentId, work.markdown, work.sourceDescription, work.sourceProvenance);
    const document = this.documents.get(documentId);
    if (!document || document.currentVersion !== version.version) {
      throw new Error("Reviewed Scout document version is not current.");
    }
    this.verifyDocumentIdentity(document, gigId);
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

  private verifyDocumentIdentity(document: ManagedDocumentRecord, gigId: string, expectedTitle?: string) {
    const exactGigOwnership = document.links.length === 1
      && document.links[0]?.entityType === "gig"
      && document.links[0].entityId === gigId;
    if (
      document.documentType !== "job_description"
      || (expectedTitle !== undefined && document.title !== expectedTitle)
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

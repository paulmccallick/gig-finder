import { describe, expect, test } from "bun:test";
import type {
  GigPostingCandidate,
  GigRecord,
  PostingCandidateResolution,
  PostingResolution,
} from "../../../gigs";
import type {
  CreateManagedDocumentInput,
  ManagedDocumentRecord,
  ManagedDocumentVersionData,
  UpdateManagedDocumentInput,
} from "../../../documents";
import { MutationError } from "../../../errors";
import type { ChangeContext } from "../../../models";
import type { ManagedDocumentService } from "../../../managed-document-service";
import type { GigDomainService } from "../../../tracker-services";
import type { NormalizedPosition } from "../../sourcing/contracts";
import type {
  ScoutPositionDetail,
  ScoutPostingResolutionStore,
  ScoutPostingReview,
  ScoutPromotionWork,
  ScoutUserDecisionCommand,
} from "../positions";
import { ScoutPositionService } from "../scout-position-service";

const fingerprint = "a".repeat(64);
const changedFingerprint = "b".repeat(64);
const positionId = `spos_${"1".repeat(32)}`;
const sourceDescription = JSON.stringify({
  scoutDescriptionId: "synthetic-description",
  officialSourceUrl: "https://careers.example.test/jobs/synthetic-42",
  retrievedAt: "2026-09-01T12:00:00Z",
  sourceKey: "official",
  configurationVersionId: "synthetic-configuration",
  extractionStrategy: "json-field-v1",
  converterVersion: "synthetic-converter-v1",
});
const sourceProvenance = {
  officialUrl: "https://careers.example.test/jobs/synthetic-42",
  retrievedAt: "2026-09-01T12:00:00Z",
  sourceContentHash: "e".repeat(64),
  extractedContentHash: "f".repeat(64),
  sourceKey: "official",
  configurationVersion: 1,
  extractionStrategy: "json-field-v1",
  converterVersion: "synthetic-converter-v1",
};

const posting: NormalizedPosition = {
  company: "Synthetic Systems",
  sourceKey: "official",
  externalId: "SYN-42",
  canonicalUrl: "https://careers.example.test/jobs/synthetic-42",
  title: "Director of Synthetic Systems",
  location: "Remote",
  locations: [{ label: "Remote", workArrangement: "remote" }],
  workArrangement: "remote",
  description: "# Director of Synthetic Systems\n\nExact reviewed Markdown.",
  provenance: {
    sourceKey: "official",
    sourceUrl: "https://careers.example.test/jobs",
    description: "listing",
    descriptionUrl: "https://careers.example.test/jobs/synthetic-42",
  },
};

const detail = (): ScoutPositionDetail => ({
  id: positionId,
  title: posting.title,
  company: posting.company,
  location: posting.location,
  canonicalUrl: posting.canonicalUrl,
  state: "needs_user_review",
  stateRevision: 7,
  processingStage: "score_candidate_match",
  processingStatus: "completed",
  processingFailureCode: null,
  processingFailureMessage: null,
  descriptionAvailable: true,
  firstSeenAt: "2026-09-01T12:00:00Z",
  lastSeenAt: "2026-09-01T12:00:00Z",
  observationCount: 1,
  score: 9,
  scoreExplanation: "Strong synthetic match.",
  criteriaVersion: 1,
  rubricVersion: 1,
  profileVersion: "synthetic-profile-v1",
  model: "synthetic-model",
  provider: "synthetic-provider",
  externalId: posting.externalId,
  sourceKey: posting.sourceKey,
  descriptionId: "synthetic-description",
  descriptionMarkdown: posting.description,
  descriptionSourceUrl: posting.provenance.descriptionUrl,
  descriptionRetrievedAt: "2026-09-01T12:00:00Z",
  descriptionProvenance: { converterVersion: "synthetic-converter-v1" },
  relevanceEvaluationId: "synthetic-relevance",
  relevanceReason: "Synthetic role is relevant.",
  candidateMatchEvaluationId: "synthetic-match",
  irrelevanceOrigin: null,
  observations: [],
});

const review = (): ScoutPostingReview => ({
  detail: detail(),
  observationId: "synthetic-observation",
  posting,
  markdown: posting.description!,
  sourceDescription,
  sourceProvenance,
});

const decision = (resolution?: PostingResolution) => ({
  action: "pursue" as const,
  actor: "Synthetic Reviewer",
  changeId: "synthetic-pursue",
  expectedStateRevision: 7,
  descriptionId: "synthetic-description",
  relevanceEvaluationId: "synthetic-relevance",
  candidateMatchEvaluationId: "synthetic-match",
  ...(resolution ? { resolution } : {}),
});

const candidate = (overrides: Partial<GigPostingCandidate> = {}): GigPostingCandidate => ({
  gigId: "synthetic-existing-gig",
  revision: 3,
  company: posting.company,
  title: posting.title,
  externalJobId: "SYN-OLD",
  sourceUrl: "https://careers.example.test/jobs/synthetic-old",
  location: "Seattle, WA",
  stage: "screening",
  outcome: "pending",
  availability: "available",
  lastActivity: "2026-08-30",
  jobDescription: null,
  matchReasons: ["company_title"],
  ...overrides,
});

const gig = (id: string, documents: GigRecord["documents"] = []): GigRecord => ({
  id,
  company: posting.company,
  title: posting.title,
  externalJobId: posting.externalId,
  artifactDirectory: `artifacts/gigs/${id}`,
  stage: "identified",
  outcome: "pending",
  statusSummary: "Promoted from Gig Scout",
  lastActivity: "2026-09-01",
  nextAction: null,
  fit: { rating: "tbd", summary: null },
  payRange: null,
  sourceUrl: posting.canonicalUrl,
  tags: [],
  hasJobDescription: documents.some(document => document.type === "job_description"),
  hasInterviewPrep: false,
  availability: "unknown",
  availabilityUpdatedAt: null,
  location: posting.location,
  workArrangement: posting.workArrangement ?? null,
  postedDate: null,
  businessUnitTeam: null,
  recruiterSource: null,
  bonus: null,
  equity: null,
  otherCompensation: null,
  documents,
  interactions: [],
});

class FakeScoutStore implements ScoutPostingResolutionStore {
  readonly review = review();
  readonly begun: Array<{ command: ScoutUserDecisionCommand; resolution: PostingResolution }> = [];
  readonly completed: Array<{ positionId: string; gigId: string; documentId: string }> = [];
  readonly failures: string[] = [];
  pending: ScoutPromotionWork | null = null;
  reviewable = true;

  reviewPosting(id: string) { return id === positionId && this.reviewable ? this.review : null; }
  beginPursue(command: ScoutUserDecisionCommand, resolution: PostingResolution) {
    if (this.pending) return this.pending;
    this.begun.push({ command, resolution });
    this.reviewable = false;
    this.pending = {
      positionId,
      observationId: this.review.observationId,
      descriptionId: this.review.detail.descriptionId!,
      changeId: command.changeId,
      actor: command.actor,
      posting: this.review.posting,
      markdown: this.review.markdown,
      sourceDescription: this.review.sourceDescription,
      sourceProvenance: this.review.sourceProvenance,
      resolution,
    };
    return this.pending;
  }
  promotionWork(id: string) { return id === positionId ? this.pending : null; }
  completePromotion(id: string, gigId: string, documentId: string) {
    this.completed.push({ positionId: id, gigId, documentId });
    this.pending = null;
  }
  failPromotion(_id: string, message: string) { this.failures.push(message); }
  positionDetail() { return null; }
  reviewDetail() { return this.reviewable ? this.review.detail : null; }
  decide(): never { throw new Error("Non-pursue decision is not used by this fake."); }
  pendingPositionJobs() { return []; }
  markPositionJobsDispatched() {}
  reconcileGig() {}
  failPositionProcessing() {}
  backfillPositions(): never { throw new Error("Not used."); }
  previewBackfill(): never { throw new Error("Not used."); }
  startBackfill(): never { throw new Error("Not used."); }
  backfillStatus() { return null; }
  workspace(): never { throw new Error("Not used."); }
  restoreAgentIrrelevant(): never { throw new Error("Not used."); }
  reverseDecision(): never { throw new Error("Not used."); }
  appendPositionNote() {}
  resurfaceDue() { return 0; }
  relevanceCriteria() { return { version: 1, criteria: "Synthetic relevance criteria.", confidenceThreshold: 0.8 }; }
  appendRelevanceCriteria(criteria: string, confidenceThreshold: number) { return { version: 2, criteria, confidenceThreshold }; }
}

class FakeGigs {
  resolution: PostingCandidateResolution = { fingerprint, candidates: [] };
  acceptedGig = gig("synthetic-created-gig");
  readonly accepted: Array<{ context: ChangeContext; posting: NormalizedPosition; resolution?: PostingResolution }> = [];
  readonly persistedChanges = new Set<string>();

  resolvePosting(value: NormalizedPosition) {
    expect(value).toEqual(posting);
    return this.resolution;
  }
  acceptPosting(context: ChangeContext, value: NormalizedPosition, resolution?: PostingResolution) {
    this.accepted.push({ context, posting: value, resolution });
    if (context.changeId) this.persistedChanges.add(context.changeId);
    return {
      status: resolution?.kind === "use_existing" ? "updated" as const : "created" as const,
      gig: this.acceptedGig,
    };
  }
}

const document = (
  id: string,
  gigId: string,
  content: string,
  overrides: Partial<ManagedDocumentRecord> = {},
): ManagedDocumentRecord => ({
  id,
  links: [{ entityType: "gig", entityId: gigId }],
  documentType: "job_description",
  title: `${posting.company} — ${posting.title}`,
  description: null,
  mediaType: "text/markdown",
  sourceDescription,
  filePath: null,
  uploadProvenance: null,
  displayName: `${posting.company} — ${posting.title}`,
  currentVersion: 1,
  content,
  contentHash: "c".repeat(64),
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
  ...overrides,
});

class FakeDocuments {
  readonly records = new Map<string, ManagedDocumentRecord>();
  readonly createdChanges = new Map<string, string>();
  readonly changedVersions = new Map<string, ManagedDocumentVersionData>();
  createAttempts = 0;
  updateAttempts = 0;
  failNextCreate = false;
  conflictAfterUpdate = false;

  get(id: string) { return this.records.get(id) ?? null; }
  createdByChange(changeId: string) {
    const id = this.createdChanges.get(changeId);
    return id ? this.get(id) : null;
  }
  versionByChange(changeId: string) { return this.changedVersions.get(changeId) ?? null; }
  create(context: ChangeContext, input: CreateManagedDocumentInput) {
    this.createAttempts++;
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error("Synthetic document creation failure.");
    }
    const existing = context.changeId ? this.createdByChange(context.changeId) : null;
    if (existing) return { document: existing, changeId: context.changeId ?? null, changed: false };
    const created = document("synthetic-created-document", input.links[0]!.entityId, input.content, {
      title: input.title,
      mediaType: input.mediaType,
      sourceDescription: input.sourceDescription,
    });
    this.records.set(created.id, created);
    if (context.changeId) this.createdChanges.set(context.changeId, created.id);
    return { document: created, changeId: context.changeId ?? null, changed: true };
  }
  update(context: ChangeContext, input: UpdateManagedDocumentInput) {
    this.updateAttempts++;
    const current = this.get(input.documentId);
    if (!current) throw new Error("Synthetic document is missing.");
    const updated = { ...current, content: input.content, currentVersion: current.currentVersion + 1 };
    this.records.set(updated.id, updated);
    const version: ManagedDocumentVersionData = {
      documentId: updated.id,
      version: updated.currentVersion,
      parentVersion: current.currentVersion,
      content: input.content,
      contentHash: "d".repeat(64),
      changeId: context.changeId!,
      changeSummary: input.changeSummary,
      createdAt: context.occurredAt!,
      createdBy: context.actor,
      sourceDescription: input.sourceDescription ?? null,
      sourceProvenance: input.sourceProvenance ?? null,
    };
    this.changedVersions.set(context.changeId!, version);
    if (this.conflictAfterUpdate) {
      this.conflictAfterUpdate = false;
      throw new MutationError("revision_conflict", "Synthetic post-commit conflict.");
    }
    return { document: updated, changeId: context.changeId ?? null, changed: true };
  }
}

const setup = () => {
  const store = new FakeScoutStore();
  const gigs: Pick<GigDomainService, "resolvePosting" | "acceptPosting"> = new FakeGigs();
  const documents: Pick<ManagedDocumentService, "get" | "create" | "update" | "createdByChange" | "versionByChange"> = new FakeDocuments();
  const service = new ScoutPositionService(store, gigs, documents);
  return { store, gigs: gigs as FakeGigs, documents: documents as FakeDocuments, service };
};

describe("ScoutPositionService reviewed posting promotion", () => {
  test("no candidate persists create-new intent before creating the Gig and document", () => {
    const { store, gigs, documents, service } = setup();

    expect(service.decide(positionId, decision())).toEqual({ status: "created", position: null });
    expect(store.begun).toHaveLength(1);
    expect(store.begun[0]!.resolution).toEqual({ kind: "create_new", reviewedFingerprint: fingerprint });
    expect(gigs.accepted[0]!.resolution).toEqual(store.begun[0]!.resolution);
    expect(gigs.accepted[0]!.context.changeId).toBe("synthetic-pursue:gig");
    expect(documents.records).toHaveLength(1);
    expect(store.completed).toEqual([{ positionId, gigId: "synthetic-created-gig", documentId: "synthetic-created-document" }]);
  });

  test("candidate discovery returns resolution-required without a decision or mutation", () => {
    const { store, gigs, documents, service } = setup();
    gigs.resolution = { fingerprint, candidates: [candidate()] };

    expect(service.decide(positionId, decision())).toEqual({ status: "resolution_required", fingerprint, candidates: gigs.resolution.candidates });
    expect(store.reviewable).toBeTrue();
    expect(store.begun).toHaveLength(0);
    expect(gigs.accepted).toHaveLength(0);
    expect(documents.records).toHaveLength(0);
    expect(store.completed).toHaveLength(0);
  });

  test("confirmed separate creation persists and applies the exact reviewed resolution", () => {
    const { store, gigs, service } = setup();
    gigs.resolution = { fingerprint, candidates: [candidate()] };
    const resolution = { kind: "create_new" as const, reviewedFingerprint: fingerprint };

    expect(service.decide(positionId, decision(resolution))).toEqual({ status: "created", position: null });
    expect(store.begun[0]!.resolution).toEqual(resolution);
    expect(gigs.accepted[0]!.resolution).toEqual(resolution);
  });

  test("confirmed existing acceptance preserves the updated domain discriminator", () => {
    const { store, gigs, service } = setup();
    const existing = candidate();
    gigs.resolution = { fingerprint, candidates: [existing] };
    gigs.acceptedGig = gig(existing.gigId);
    const resolution = { kind: "use_existing" as const, reviewedFingerprint: fingerprint, gigId: existing.gigId, expectedGigRevision: existing.revision };

    expect(service.decide(positionId, decision(resolution))).toEqual({ status: "updated", position: null });
    expect(store.begun[0]!.resolution).toEqual(resolution);
    expect(store.completed[0]!.gigId).toBe(existing.gigId);
  });

  test.each([
    ["stale fingerprint", { kind: "create_new" as const, reviewedFingerprint: changedFingerprint }, "resolution_stale"],
    ["stale Gig revision", { kind: "use_existing" as const, reviewedFingerprint: fingerprint, gigId: "synthetic-existing-gig", expectedGigRevision: 2 }, "resolution_stale"],
    ["invalid Gig selection", { kind: "use_existing" as const, reviewedFingerprint: fingerprint, gigId: "synthetic-unreviewed-gig", expectedGigRevision: 1 }, "resolution_invalid"],
  ])("%s remains an ordinary value and leaves the position reviewable", (_name, resolution, expectedStatus) => {
    const { store, gigs, service } = setup();
    gigs.resolution = { fingerprint, candidates: [candidate()] };

    expect(service.decide(positionId, decision(resolution))).toMatchObject({ status: expectedStatus });
    expect(store.reviewable).toBeTrue();
    expect(store.begun).toHaveLength(0);
    expect(gigs.accepted).toHaveLength(0);
  });

  test("malformed resolution throws before recording promotion intent", () => {
    const { store, service } = setup();
    const malformed = { kind: "create_new", reviewedFingerprint: "not-a-fingerprint" } as PostingResolution;

    expect(() => service.decide(positionId, decision(malformed))).toThrow();
    expect(store.reviewable).toBeTrue();
    expect(store.begun).toHaveLength(0);
  });

  test("changed Markdown adds exactly one version to the selected existing document", () => {
    const { store, gigs, documents, service } = setup();
    const existingDocument = document("synthetic-existing-document", "synthetic-existing-gig", "# Earlier Markdown");
    documents.records.set(existingDocument.id, existingDocument);
    const existing = candidate({ jobDescription: { id: existingDocument.id, type: "job_description", title: existingDocument.title, displayName: existingDocument.displayName } });
    gigs.resolution = { fingerprint, candidates: [existing] };
    gigs.acceptedGig = gig(existing.gigId, [existing.jobDescription!]);
    const resolution = { kind: "use_existing" as const, reviewedFingerprint: fingerprint, gigId: existing.gigId, expectedGigRevision: existing.revision };

    expect(service.decide(positionId, decision(resolution))).toEqual({ status: "updated", position: null });
    expect(documents.createAttempts).toBe(0);
    expect(documents.updateAttempts).toBe(1);
    expect(documents.get(existingDocument.id)).toMatchObject({ currentVersion: 2, content: posting.description });
    expect(store.completed[0]!.documentId).toBe(existingDocument.id);
  });

  test("unchanged Markdown creates no document version", () => {
    const { gigs, documents, service } = setup();
    const existingDocument = document("synthetic-existing-document", "synthetic-existing-gig", posting.description!);
    documents.records.set(existingDocument.id, existingDocument);
    const existing = candidate({ jobDescription: { id: existingDocument.id, type: "job_description", title: existingDocument.title, displayName: existingDocument.displayName } });
    gigs.resolution = { fingerprint, candidates: [existing] };
    gigs.acceptedGig = gig(existing.gigId, [existing.jobDescription!]);
    const resolution = { kind: "use_existing" as const, reviewedFingerprint: fingerprint, gigId: existing.gigId, expectedGigRevision: existing.revision };

    expect(service.decide(positionId, decision(resolution))).toEqual({ status: "updated", position: null });
    expect(documents.createAttempts).toBe(0);
    expect(documents.updateAttempts).toBe(0);
    expect(documents.changedVersions).toHaveLength(0);
  });

  test("document failure retries without another Gig write or document version", () => {
    const { store, gigs, documents, service } = setup();
    documents.failNextCreate = true;

    expect(() => service.decide(positionId, decision())).toThrow("Synthetic document creation failure.");
    expect(store.failures).toEqual(["Synthetic document creation failure."]);
    expect(gigs.persistedChanges).toHaveLength(1);
    expect(documents.records).toHaveLength(0);

    expect(service.retryPromotion(positionId)).toEqual({ status: "created", position: null });
    expect(gigs.persistedChanges).toHaveLength(1);
    expect(documents.records).toHaveLength(1);
    expect(documents.changedVersions).toHaveLength(0);
    expect(store.completed).toHaveLength(1);
  });

  test("document update conflict reconciles the exact deterministic version change", () => {
    const { gigs, documents, service } = setup();
    const existingDocument = document("synthetic-existing-document", "synthetic-existing-gig", "# Earlier Markdown");
    documents.records.set(existingDocument.id, existingDocument);
    documents.conflictAfterUpdate = true;
    const existing = candidate({ jobDescription: { id: existingDocument.id, type: "job_description", title: existingDocument.title, displayName: existingDocument.displayName } });
    gigs.resolution = { fingerprint, candidates: [existing] };
    gigs.acceptedGig = gig(existing.gigId, [existing.jobDescription!]);
    const resolution = { kind: "use_existing" as const, reviewedFingerprint: fingerprint, gigId: existing.gigId, expectedGigRevision: existing.revision };

    expect(service.decide(positionId, decision(resolution))).toEqual({ status: "updated", position: null });
    expect(documents.updateAttempts).toBe(1);
    expect(documents.changedVersions.get("synthetic-pursue:document")).toMatchObject({
      documentId: existingDocument.id,
      content: posting.description,
      sourceDescription,
    });
  });
});

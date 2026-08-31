import type { GigInput } from "../../gigs";
import type { ManagedDocumentService } from "../../managed-document-service";
import type { GigDomainService } from "../../tracker-services";
import type { ScoutPositionBackfillCommand, ScoutPositionDetail, ScoutPositionStore, ScoutUserDecisionCommand } from "./positions";

const exactPositionIdPattern=/^spos_[0-9a-f]{32}$/;

function normalizeBackfillCommand(input:unknown):ScoutPositionBackfillCommand{
  if(typeof input!=="object"||input===null||Array.isArray(input))throw new Error("Scout position backfill request must be an object.");
  const record=input as Record<string,unknown>;
  const keys=Object.keys(record).sort();
  if(keys.length!==2||keys[0]!=="positionIds"||keys[1]!=="reason")throw new Error("Scout position backfill accepts only positionIds and reason.");
  if(!Array.isArray(record.positionIds)||record.positionIds.length<1||record.positionIds.length>1000)throw new Error("Scout position backfill requires between 1 and 1,000 exact position IDs.");
  if(record.positionIds.some(positionId=>typeof positionId!=="string"||!exactPositionIdPattern.test(positionId)))throw new Error("Scout position backfill contains a malformed position ID.");
  const reason=typeof record.reason==="string"?record.reason.trim():"";
  if(reason.length<1||reason.length>500)throw new Error("Scout position backfill reason must contain between 1 and 500 characters.");
  return{positionIds:[...new Set(record.positionIds as string[])].sort(),reason};
}

export class ScoutPositionService {
  constructor(
    private readonly store: ScoutPositionStore,
    private readonly gigs: Pick<GigDomainService, "createNew">,
    private readonly documents: Pick<ManagedDocumentService, "create" | "createdByChange">,
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

  decide(positionId: string, input: Omit<ScoutUserDecisionCommand, "positionId">) {
    if (!input.changeId?.trim() || !input.actor?.trim()) throw new Error("Decision change ID and actor are required.");
    if (input.note !== undefined && (input.note.trim().length < 1 || input.note.length > 2000)) throw new Error("Decision note must contain 1 to 2000 characters.");
    if (input.action === "defer" && (!input.reviewAt || Number.isNaN(Date.parse(input.reviewAt)))) throw new Error("Defer requires a valid reviewAt timestamp.");
    const now = new Date().toISOString();
    const result = this.store.decide({ ...input, positionId, changeId: input.changeId.trim(), actor: input.actor.trim(), note: input.note?.trim() }, now);
    return input.action === "pursue" ? this.promote(positionId, now) : result;
  }

  restore(positionId: string, input: { changeId: string; actor: string; expectedStateRevision: number }) { return this.store.restoreAgentIrrelevant({ ...input, positionId }, new Date().toISOString()); }
  reverse(positionId: string, input: { decisionId: string; changeId: string; actor: string; expectedStateRevision: number }) { return this.store.reverseDecision({ ...input, positionId }, new Date().toISOString()); }
  addNote(positionId: string, input: { decisionId?: string; actor: string; body: string }) { const body = input.body?.trim(); if (!body || body.length > 2000) throw new Error("Position note must contain 1 to 2000 characters."); this.store.appendPositionNote({ ...input, positionId, body }, new Date().toISOString()); return { ok: true }; }
  retryPromotion(positionId: string) { return this.promote(positionId, new Date().toISOString()); }
  relevance() { return this.store.relevanceCriteria(); }
  configureRelevance(input: { criteria: unknown; confidenceThreshold: unknown }) { if (typeof input.criteria !== "string" || input.criteria.trim().length < 10 || input.criteria.length > 4_000) throw new Error("Relevance criteria must contain 10 to 4000 characters."); if (typeof input.confidenceThreshold !== "number" || input.confidenceThreshold < 0 || input.confidenceThreshold > 1) throw new Error("Relevance confidence threshold must be from 0 through 1."); return this.store.appendRelevanceCriteria(input.criteria.trim(), input.confidenceThreshold, new Date().toISOString()); }
  backfill(sourceRunId: string, limit = 100) { if (!sourceRunId.trim()) throw new Error("A source Scout run ID is required."); if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Backfill limit must be from 1 through 1000."); return this.store.backfillPositions(sourceRunId.trim(), limit, new Date().toISOString()); }
  previewBackfill(input:unknown){return this.store.previewBackfill(normalizeBackfillCommand(input));}
  startBackfill(input:unknown){return this.store.startBackfill(normalizeBackfillCommand(input),new Date().toISOString());}
  backfillStatus(runId:string){
    const normalized=runId.trim();
    if(!/^srun_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized))throw new Error("A valid Scout position backfill run ID is required.");
    return this.store.backfillStatus(normalized);
  }

  private promote(positionId: string, now: string): ScoutPositionDetail | null {
    try {
      const work = this.store.promotionWork(positionId);
      if (!work) return this.store.reviewDetail?.(positionId) ?? this.store.positionDetail(positionId);
      const gig: GigInput = { company: work.company, title: work.title, externalJobId: work.externalId, stage: "identified", outcome: "pending", statusSummary: "Promoted from Gig Scout", lastActivity: now.slice(0, 10), nextAction: null, fit: { rating: "tbd", summary: null }, payRange: null, sourceUrl: work.sourceUrl, tags: [], location: work.location, workArrangement: null, postedDate: null, businessUnitTeam: null, recruiterSource: null, bonus: null, equity: null, otherCompensation: null };
      this.gigs.createNew({ actor: work.actor, source: "automation", summary: "Promote Scout position to Gig", changeId: `${work.changeId}:gig`, occurredAt: now }, work.gigId, gig);
      const documentChangeId = `${work.changeId}:document`;
      const expectedTitle = `${work.company} — ${work.title}`;
      const document = this.documents.createdByChange(documentChangeId) ?? this.documents.create({ actor: work.actor, source: "automation", summary: "Create reviewed Scout job description", changeId: documentChangeId, occurredAt: now }, { links: [{ entityType: "gig", entityId: work.gigId }], documentType: "job_description", title: expectedTitle, mediaType: "text/markdown", sourceDescription: work.sourceDescription, content: work.markdown, uploadProvenance: null }).document;
      const exactGigOwnership = document.links.length === 1 && document.links[0]?.entityType === "gig" && document.links[0].entityId === work.gigId;
      if (document.content !== work.markdown || document.documentType !== "job_description" || document.title !== expectedTitle || document.mediaType !== "text/markdown" || document.sourceDescription !== work.sourceDescription || !exactGigOwnership) throw new Error("Reviewed Scout document replay does not match the persisted promotion.");
      this.store.completePromotion(positionId, work.gigId, document.id, now);
    } catch (reason) {
      this.store.failPromotion(positionId, reason instanceof Error ? reason.message : "Promotion failed.", now);
    }
    return this.store.reviewDetail?.(positionId) ?? this.store.positionDetail(positionId);
  }
}

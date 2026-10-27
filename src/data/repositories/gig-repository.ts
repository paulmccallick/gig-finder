import type { GigData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { Repository, RepositoryConfig, RepositoryListOptions } from "./audited-port";

export const gigRepositoryConfig: RepositoryConfig<GigData> = { entity:"gig", operations:{get:"gig.read",list:"gig.list",create:"gig.create",update:"gig.update",touch:"gig.touch",revert:"gig.revert",delete:"gig.delete",restoreSnapshot:"gig.restore_snapshot",restore:"gig.restore"}, table:"gigs", historyTable:"gig_history", columns:{ id:"id", company:"company", title:"title", externalJobId:"external_job_id", stage:"stage", outcome:"outcome", statusSummary:"status_summary", lastActivity:"last_activity", nextActionDescription:"next_action_description", nextActionDue:"next_action_due", fitRating:"fit_rating", fitSummary:"fit_summary", payCurrency:"pay_currency", payMinimum:"pay_minimum", payMaximum:"pay_maximum", payPeriod:"pay_period", payNotes:"pay_notes", sourceUrl:"source_url", location:"location", workArrangement:"work_arrangement", postedDate:"posted_date", businessUnitTeam:"business_unit_team", recruiterSource:"recruiter_source", bonus:"bonus", equity:"equity", otherCompensation:"other_compensation", tagsJson:"tags_json", availability:"availability", availabilityUpdatedAt:"availability_updated_at" } };
export class GigRepository implements Repository<GigData> {
  private readonly persistence: RepositoryFacade<GigData>;
  constructor(persistence: Repository<GigData>) { this.persistence = new RepositoryFacade(persistence); }
  get(id: string, options?: { includeDeleted?: boolean }) { return this.persistence.get(id, options); }
  list(options?: RepositoryListOptions<GigData>) { return this.persistence.list(options); }
  operation(name: Parameters<Repository<GigData>["operation"]>[0]) { return this.persistence.operation(name); }
  create(input: GigData, options?: { reversible?: boolean }) { return this.persistence.create(input, options); }
  update(id: string, expectedRevision: number, patch: Partial<Omit<GigData, "id">>) { return this.persistence.update(id, expectedRevision, patch); }
  touch(id: string, expectedRevision: number) { return this.persistence.touch(id, expectedRevision); }
  revert(id: string, expectedRevision: number, snapshot: Parameters<Repository<GigData>["revert"]>[2]) { return this.persistence.revert(id, expectedRevision, snapshot); }
  delete(id: string, expectedRevision: number) { return this.persistence.delete(id, expectedRevision); }
  restoreSnapshot(id: string, expectedRevision: number, snapshot: Parameters<Repository<GigData>["restoreSnapshot"]>[2]) { return this.persistence.restoreSnapshot(id, expectedRevision, snapshot); }
  restore(id: string, expectedRevision: number, patch: Partial<Omit<GigData, "id">>) { return this.persistence.restore(id, expectedRevision, patch); }
}

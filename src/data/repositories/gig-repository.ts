import type { GigData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { AuditedRepositoryPort, RepositoryConfig } from "./audited-port";

export const gigRepositoryConfig: RepositoryConfig<GigData> = { entity:"gig", table:"gigs", historyTable:"gig_history", columns:{ id:"id", company:"company", title:"title", externalJobId:"external_job_id", stage:"stage", outcome:"outcome", statusSummary:"status_summary", lastActivity:"last_activity", nextActionDescription:"next_action_description", nextActionDue:"next_action_due", fitRating:"fit_rating", fitSummary:"fit_summary", payCurrency:"pay_currency", payMinimum:"pay_minimum", payMaximum:"pay_maximum", payPeriod:"pay_period", payNotes:"pay_notes", sourceUrl:"source_url", location:"location", workArrangement:"work_arrangement", postedDate:"posted_date", businessUnitTeam:"business_unit_team", recruiterSource:"recruiter_source", bonus:"bonus", equity:"equity", otherCompensation:"other_compensation", tagsJson:"tags_json", availability:"availability", availabilityUpdatedAt:"availability_updated_at" } };
export class GigRepository {
  private readonly facade: RepositoryFacade<GigData>;
  declare readonly get: RepositoryFacade<GigData>["get"];
  declare readonly list: RepositoryFacade<GigData>["list"];
  declare readonly create: RepositoryFacade<GigData>["create"];
  declare readonly update: RepositoryFacade<GigData>["update"];
  declare readonly touch: RepositoryFacade<GigData>["touch"];
  declare readonly revert: RepositoryFacade<GigData>["revert"];
  declare readonly delete: RepositoryFacade<GigData>["delete"];
  declare readonly restoreSnapshot: RepositoryFacade<GigData>["restoreSnapshot"];
  declare readonly restore: RepositoryFacade<GigData>["restore"];
  constructor(persistence: AuditedRepositoryPort<GigData>) {
    this.facade = new RepositoryFacade(persistence);
    Object.assign(this, this.facade);
  }
}

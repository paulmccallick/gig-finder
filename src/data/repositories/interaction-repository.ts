import type { InteractionData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { AuditedRepositoryPort, RepositoryConfig } from "./audited-port";
export const interactionRepositoryConfig: RepositoryConfig<InteractionData> = { entity:"interaction", table:"interactions", historyTable:"interaction_history", columns:{ id:"id", subject:"subject", kind:"kind", channel:"channel", direction:"direction", status:"status", startsAt:"starts_at", endsAt:"ends_at", timezone:"timezone", location:"location", summary:"summary", notes:"notes", gigId:"gig_id", supersedesInteractionId:"supersedes_interaction_id", originChangeId:"origin_change_id", structuredDataJson:"structured_data_json" } };
export class InteractionRepository {
  private readonly facade: RepositoryFacade<InteractionData>;
  declare readonly get: RepositoryFacade<InteractionData>["get"];
  declare readonly list: RepositoryFacade<InteractionData>["list"];
  declare readonly create: RepositoryFacade<InteractionData>["create"];
  declare readonly update: RepositoryFacade<InteractionData>["update"];
  declare readonly touch: RepositoryFacade<InteractionData>["touch"];
  declare readonly revert: RepositoryFacade<InteractionData>["revert"];
  declare readonly delete: RepositoryFacade<InteractionData>["delete"];
  declare readonly restoreSnapshot: RepositoryFacade<InteractionData>["restoreSnapshot"];
  declare readonly restore: RepositoryFacade<InteractionData>["restore"];
  constructor(persistence: AuditedRepositoryPort<InteractionData>) {
    this.facade = new RepositoryFacade(persistence);
    Object.assign(this, this.facade);
  }
}

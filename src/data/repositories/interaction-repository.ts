import type { InteractionData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { Repository, RepositoryConfig, RepositoryListOptions } from "./audited-port";
export const interactionRepositoryConfig: RepositoryConfig<InteractionData> = { entity:"interaction", operations:{get:"interaction.read",list:"interaction.list",create:"interaction.create",update:"interaction.update",touch:"interaction.touch",revert:"interaction.revert",delete:"interaction.delete",restoreSnapshot:"interaction.restore_snapshot",restore:"interaction.restore"}, table:"interactions", historyTable:"interaction_history", columns:{ id:"id", subject:"subject", kind:"kind", channel:"channel", direction:"direction", status:"status", startsAt:"starts_at", endsAt:"ends_at", timezone:"timezone", location:"location", summary:"summary", notes:"notes", gigId:"gig_id", supersedesInteractionId:"supersedes_interaction_id", originChangeId:"origin_change_id", structuredDataJson:"structured_data_json" } };
export class InteractionRepository implements Repository<InteractionData> {
  private readonly persistence: RepositoryFacade<InteractionData>;
  constructor(persistence: Repository<InteractionData>) { this.persistence = new RepositoryFacade(persistence); }
  get(id: string, options?: { includeDeleted?: boolean }) { return this.persistence.get(id, options); }
  list(options?: RepositoryListOptions<InteractionData>) { return this.persistence.list(options); }
  operation(name: Parameters<Repository<InteractionData>["operation"]>[0]) { return this.persistence.operation(name); }
  create(input: InteractionData, options?: { reversible?: boolean }) { return this.persistence.create(input, options); }
  update(id: string, expectedRevision: number, patch: Partial<Omit<InteractionData, "id">>) { return this.persistence.update(id, expectedRevision, patch); }
  touch(id: string, expectedRevision: number) { return this.persistence.touch(id, expectedRevision); }
  revert(id: string, expectedRevision: number, snapshot: Parameters<Repository<InteractionData>["revert"]>[2]) { return this.persistence.revert(id, expectedRevision, snapshot); }
  delete(id: string, expectedRevision: number) { return this.persistence.delete(id, expectedRevision); }
  restoreSnapshot(id: string, expectedRevision: number, snapshot: Parameters<Repository<InteractionData>["restoreSnapshot"]>[2]) { return this.persistence.restoreSnapshot(id, expectedRevision, snapshot); }
  restore(id: string, expectedRevision: number, patch: Partial<Omit<InteractionData, "id">>) { return this.persistence.restore(id, expectedRevision, patch); }
}

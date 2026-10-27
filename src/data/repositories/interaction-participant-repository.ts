import type { InteractionParticipantData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { Repository, RepositoryConfig, RepositoryListOptions } from "./audited-port";
export const interactionParticipantRepositoryConfig: RepositoryConfig<InteractionParticipantData> = { entity:"interaction-participant", operations:{get:"interaction-participant.read",list:"interaction-participant.list",create:"interaction-participant.create",update:"interaction-participant.update",touch:"interaction-participant.touch",revert:"interaction-participant.revert",delete:"interaction-participant.delete",restoreSnapshot:"interaction-participant.restore_snapshot",restore:"interaction-participant.restore"}, table:"interaction_participants", historyTable:"interaction_participant_history", columns:{ id:"id", interactionId:"interaction_id", personId:"person_id" } };
export class InteractionParticipantRepository implements Repository<InteractionParticipantData> {
  private readonly persistence: RepositoryFacade<InteractionParticipantData>;
  constructor(persistence: Repository<InteractionParticipantData>) { this.persistence = new RepositoryFacade(persistence); }
  get(id: string, options?: { includeDeleted?: boolean }) { return this.persistence.get(id, options); }
  list(options?: RepositoryListOptions<InteractionParticipantData>) { return this.persistence.list(options); }
  operation(name: Parameters<Repository<InteractionParticipantData>["operation"]>[0]) { return this.persistence.operation(name); }
  create(input: InteractionParticipantData, options?: { reversible?: boolean }) { return this.persistence.create(input, options); }
  update(id: string, expectedRevision: number, patch: Partial<Omit<InteractionParticipantData, "id">>) { return this.persistence.update(id, expectedRevision, patch); }
  touch(id: string, expectedRevision: number) { return this.persistence.touch(id, expectedRevision); }
  revert(id: string, expectedRevision: number, snapshot: Parameters<Repository<InteractionParticipantData>["revert"]>[2]) { return this.persistence.revert(id, expectedRevision, snapshot); }
  delete(id: string, expectedRevision: number) { return this.persistence.delete(id, expectedRevision); }
  restoreSnapshot(id: string, expectedRevision: number, snapshot: Parameters<Repository<InteractionParticipantData>["restoreSnapshot"]>[2]) { return this.persistence.restoreSnapshot(id, expectedRevision, snapshot); }
  restore(id: string, expectedRevision: number, patch: Partial<Omit<InteractionParticipantData, "id">>) { return this.persistence.restore(id, expectedRevision, patch); }
}

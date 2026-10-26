import type { InteractionParticipantData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { AuditedRepositoryPort, RepositoryConfig } from "./audited-port";
export const interactionParticipantRepositoryConfig: RepositoryConfig<InteractionParticipantData> = { entity:"interaction-participant", table:"interaction_participants", historyTable:"interaction_participant_history", columns:{ id:"id", interactionId:"interaction_id", personId:"person_id" } };
export class InteractionParticipantRepository {
  private readonly facade: RepositoryFacade<InteractionParticipantData>;
  declare readonly get: RepositoryFacade<InteractionParticipantData>["get"];
  declare readonly list: RepositoryFacade<InteractionParticipantData>["list"];
  declare readonly create: RepositoryFacade<InteractionParticipantData>["create"];
  declare readonly update: RepositoryFacade<InteractionParticipantData>["update"];
  declare readonly touch: RepositoryFacade<InteractionParticipantData>["touch"];
  declare readonly revert: RepositoryFacade<InteractionParticipantData>["revert"];
  declare readonly delete: RepositoryFacade<InteractionParticipantData>["delete"];
  declare readonly restoreSnapshot: RepositoryFacade<InteractionParticipantData>["restoreSnapshot"];
  declare readonly restore: RepositoryFacade<InteractionParticipantData>["restore"];
  constructor(persistence: AuditedRepositoryPort<InteractionParticipantData>) {
    this.facade = new RepositoryFacade(persistence);
    Object.assign(this, this.facade);
  }
}

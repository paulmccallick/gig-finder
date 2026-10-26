import type { GigPersonData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { AuditedRepositoryPort, RepositoryConfig } from "./audited-port";
export const gigPersonRepositoryConfig: RepositoryConfig<GigPersonData> = { entity:"gig-person", table:"gig_people", historyTable:"gig_people_history", columns:{ id:"id", gigId:"gig_id", personId:"person_id", relationship:"relationship", notes:"notes" } };
export class GigPersonRepository {
  private readonly facade: RepositoryFacade<GigPersonData>;
  declare readonly get: RepositoryFacade<GigPersonData>["get"];
  declare readonly list: RepositoryFacade<GigPersonData>["list"];
  declare readonly create: RepositoryFacade<GigPersonData>["create"];
  declare readonly update: RepositoryFacade<GigPersonData>["update"];
  declare readonly touch: RepositoryFacade<GigPersonData>["touch"];
  declare readonly revert: RepositoryFacade<GigPersonData>["revert"];
  declare readonly delete: RepositoryFacade<GigPersonData>["delete"];
  declare readonly restoreSnapshot: RepositoryFacade<GigPersonData>["restoreSnapshot"];
  declare readonly restore: RepositoryFacade<GigPersonData>["restore"];
  constructor(persistence: AuditedRepositoryPort<GigPersonData>) {
    this.facade = new RepositoryFacade(persistence);
    Object.assign(this, this.facade);
  }
}

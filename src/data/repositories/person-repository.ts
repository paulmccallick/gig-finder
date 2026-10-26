import type { PersonData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { AuditedRepositoryPort, RepositoryConfig } from "./audited-port";
export const personRepositoryConfig: RepositoryConfig<PersonData> = { entity:"person", table:"people", historyTable:"person_history", columns:{ id:"id", name:"name", company:"company", title:"title", linkedInProfileUrl:"linkedin_profile_url", connectedOn:"connected_on", relationshipType:"relationship_type", relationshipStrength:"relationship_strength", introducedBy:"introduced_by", relationshipNotes:"relationship_notes", priority:"priority", status:"status", whyInteresting:"why_interesting", notesJson:"notes_json", tagsJson:"tags_json" } };
export class PersonRepository {
  private readonly facade: RepositoryFacade<PersonData>;
  declare readonly get: RepositoryFacade<PersonData>["get"];
  declare readonly list: RepositoryFacade<PersonData>["list"];
  declare readonly create: RepositoryFacade<PersonData>["create"];
  declare readonly update: RepositoryFacade<PersonData>["update"];
  declare readonly touch: RepositoryFacade<PersonData>["touch"];
  declare readonly revert: RepositoryFacade<PersonData>["revert"];
  declare readonly delete: RepositoryFacade<PersonData>["delete"];
  declare readonly restoreSnapshot: RepositoryFacade<PersonData>["restoreSnapshot"];
  declare readonly restore: RepositoryFacade<PersonData>["restore"];
  constructor(persistence: AuditedRepositoryPort<PersonData>) {
    this.facade = new RepositoryFacade(persistence);
    Object.assign(this, this.facade);
  }
}

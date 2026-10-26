import type { PersonData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { Repository, RepositoryConfig } from "./audited-port";
export const personRepositoryConfig: RepositoryConfig<PersonData> = { entity:"person", table:"people", historyTable:"person_history", columns:{ id:"id", name:"name", company:"company", title:"title", linkedInProfileUrl:"linkedin_profile_url", connectedOn:"connected_on", relationshipType:"relationship_type", relationshipStrength:"relationship_strength", introducedBy:"introduced_by", relationshipNotes:"relationship_notes", priority:"priority", status:"status", whyInteresting:"why_interesting", notesJson:"notes_json", tagsJson:"tags_json" } };
export class PersonRepository implements Repository<PersonData> {
  private readonly persistence: RepositoryFacade<PersonData>;
  constructor(persistence: Repository<PersonData>) { this.persistence = new RepositoryFacade(persistence); }
  get(id: string, options?: { includeDeleted?: boolean }) { return this.persistence.get(id, options); }
  list(options?: { includeDeleted?: boolean }) { return this.persistence.list(options); }
  create(input: PersonData, options?: { reversible?: boolean }) { return this.persistence.create(input, options); }
  update(id: string, expectedRevision: number, patch: Partial<Omit<PersonData, "id">>) { return this.persistence.update(id, expectedRevision, patch); }
  touch(id: string, expectedRevision: number) { return this.persistence.touch(id, expectedRevision); }
  revert(id: string, expectedRevision: number, snapshot: Parameters<Repository<PersonData>["revert"]>[2]) { return this.persistence.revert(id, expectedRevision, snapshot); }
  delete(id: string, expectedRevision: number) { return this.persistence.delete(id, expectedRevision); }
  restoreSnapshot(id: string, expectedRevision: number, snapshot: Parameters<Repository<PersonData>["restoreSnapshot"]>[2]) { return this.persistence.restoreSnapshot(id, expectedRevision, snapshot); }
  restore(id: string, expectedRevision: number, patch: Partial<Omit<PersonData, "id">>) { return this.persistence.restore(id, expectedRevision, patch); }
}

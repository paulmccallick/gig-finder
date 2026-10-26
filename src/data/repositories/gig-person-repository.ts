import type { GigPersonData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { Repository, RepositoryConfig } from "./audited-port";
export const gigPersonRepositoryConfig: RepositoryConfig<GigPersonData> = { entity:"gig-person", operations:{get:"gig-person.read",list:"gig-person.list",create:"gig-person.create",update:"gig-person.update",touch:"gig-person.touch",revert:"gig-person.revert",delete:"gig-person.delete",restoreSnapshot:"gig-person.restore_snapshot",restore:"gig-person.restore"}, table:"gig_people", historyTable:"gig_people_history", columns:{ id:"id", gigId:"gig_id", personId:"person_id", relationship:"relationship", notes:"notes" } };
export class GigPersonRepository implements Repository<GigPersonData> {
  private readonly persistence: RepositoryFacade<GigPersonData>;
  constructor(persistence: Repository<GigPersonData>) { this.persistence = new RepositoryFacade(persistence); }
  get(id: string, options?: { includeDeleted?: boolean }) { return this.persistence.get(id, options); }
  list(options?: { includeDeleted?: boolean }) { return this.persistence.list(options); }
  operation(name: Parameters<Repository<GigPersonData>["operation"]>[0]) { return this.persistence.operation(name); }
  create(input: GigPersonData, options?: { reversible?: boolean }) { return this.persistence.create(input, options); }
  update(id: string, expectedRevision: number, patch: Partial<Omit<GigPersonData, "id">>) { return this.persistence.update(id, expectedRevision, patch); }
  touch(id: string, expectedRevision: number) { return this.persistence.touch(id, expectedRevision); }
  revert(id: string, expectedRevision: number, snapshot: Parameters<Repository<GigPersonData>["revert"]>[2]) { return this.persistence.revert(id, expectedRevision, snapshot); }
  delete(id: string, expectedRevision: number) { return this.persistence.delete(id, expectedRevision); }
  restoreSnapshot(id: string, expectedRevision: number, snapshot: Parameters<Repository<GigPersonData>["restoreSnapshot"]>[2]) { return this.persistence.restoreSnapshot(id, expectedRevision, snapshot); }
  restore(id: string, expectedRevision: number, patch: Partial<Omit<GigPersonData, "id">>) { return this.persistence.restore(id, expectedRevision, patch); }
}

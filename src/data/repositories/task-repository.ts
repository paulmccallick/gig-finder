import type { TaskData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { Repository, RepositoryConfig } from "./audited-port";
export const taskRepositoryConfig: RepositoryConfig<TaskData> = { entity:"task", operations:{get:"task.read",list:"task.list",create:"task.create",update:"task.update",touch:"task.touch",revert:"task.revert",delete:"task.delete",restoreSnapshot:"task.restore_snapshot",restore:"task.restore"}, table:"tasks", historyTable:"task_history", columns:{ id:"id", title:"title", type:"type", status:"status", priority:"priority", dueDate:"due_date", relatedEntityType:"related_entity_type", relatedEntityId:"related_entity_id", relatedEntityLabel:"related_entity_label", notes:"notes", completedAt:"completed_at" } };
export class TaskRepository implements Repository<TaskData> {
  private readonly persistence: RepositoryFacade<TaskData>;
  constructor(persistence: Repository<TaskData>) { this.persistence = new RepositoryFacade(persistence); }
  get(id: string, options?: { includeDeleted?: boolean }) { return this.persistence.get(id, options); }
  list(options?: { includeDeleted?: boolean }) { return this.persistence.list(options); }
  operation(name: Parameters<Repository<TaskData>["operation"]>[0]) { return this.persistence.operation(name); }
  create(input: TaskData, options?: { reversible?: boolean }) { return this.persistence.create(input, options); }
  update(id: string, expectedRevision: number, patch: Partial<Omit<TaskData, "id">>) { return this.persistence.update(id, expectedRevision, patch); }
  touch(id: string, expectedRevision: number) { return this.persistence.touch(id, expectedRevision); }
  revert(id: string, expectedRevision: number, snapshot: Parameters<Repository<TaskData>["revert"]>[2]) { return this.persistence.revert(id, expectedRevision, snapshot); }
  delete(id: string, expectedRevision: number) { return this.persistence.delete(id, expectedRevision); }
  restoreSnapshot(id: string, expectedRevision: number, snapshot: Parameters<Repository<TaskData>["restoreSnapshot"]>[2]) { return this.persistence.restoreSnapshot(id, expectedRevision, snapshot); }
  restore(id: string, expectedRevision: number, patch: Partial<Omit<TaskData, "id">>) { return this.persistence.restore(id, expectedRevision, patch); }
}

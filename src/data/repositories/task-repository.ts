import type { TaskData } from "../../core/models";
import { RepositoryFacade } from "./repository-facade";
import type { AuditedRepositoryPort, RepositoryConfig } from "./audited-port";
export const taskRepositoryConfig: RepositoryConfig<TaskData> = { entity:"task", table:"tasks", historyTable:"task_history", columns:{ id:"id", title:"title", type:"type", status:"status", priority:"priority", dueDate:"due_date", relatedEntityType:"related_entity_type", relatedEntityId:"related_entity_id", relatedEntityLabel:"related_entity_label", notes:"notes", completedAt:"completed_at" } };
export class TaskRepository {
  private readonly facade: RepositoryFacade<TaskData>;
  declare readonly get: RepositoryFacade<TaskData>["get"];
  declare readonly list: RepositoryFacade<TaskData>["list"];
  declare readonly create: RepositoryFacade<TaskData>["create"];
  declare readonly update: RepositoryFacade<TaskData>["update"];
  declare readonly touch: RepositoryFacade<TaskData>["touch"];
  declare readonly revert: RepositoryFacade<TaskData>["revert"];
  declare readonly delete: RepositoryFacade<TaskData>["delete"];
  declare readonly restoreSnapshot: RepositoryFacade<TaskData>["restoreSnapshot"];
  declare readonly restore: RepositoryFacade<TaskData>["restore"];
  constructor(persistence: AuditedRepositoryPort<TaskData>) {
    this.facade = new RepositoryFacade(persistence);
    Object.assign(this, this.facade);
  }
}

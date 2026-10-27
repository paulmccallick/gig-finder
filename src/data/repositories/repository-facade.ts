import type { EntityRecord } from "../../core/models";
import type { Repository, RepositoryListOptions, RepositoryOperations } from "./audited-port";

export class RepositoryFacade<T extends { id: string }> implements Repository<T> {
  constructor(private readonly persistence: Repository<T>) {}

  readonly get = (id: string, options?: { includeDeleted?: boolean }) => this.persistence.get(id, options);
  readonly list = (options?: RepositoryListOptions<T>) => this.persistence.list(options);
  readonly operation = (name: keyof RepositoryOperations) => this.persistence.operation(name);
  readonly create = (input: T, options?: { reversible?: boolean }) => this.persistence.create(input, options);
  readonly update = (id: string, expectedRevision: number, patch: Partial<Omit<T, "id">>) => this.persistence.update(id, expectedRevision, patch);
  readonly touch = (id: string, expectedRevision: number) => this.persistence.touch(id, expectedRevision);
  readonly revert = (id: string, expectedRevision: number, snapshot: EntityRecord<T>) => this.persistence.revert(id, expectedRevision, snapshot);
  readonly delete = (id: string, expectedRevision: number) => this.persistence.delete(id, expectedRevision);
  readonly restoreSnapshot = (id: string, expectedRevision: number, snapshot: EntityRecord<T>) => this.persistence.restoreSnapshot(id, expectedRevision, snapshot);
  readonly restore = (id: string, expectedRevision: number, patch: Partial<Omit<T, "id">>) => this.persistence.restore(id, expectedRevision, patch);
}

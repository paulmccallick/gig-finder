import type { ChangeContext, EntityRecord } from "../../core/models";

export type RepositoryConfig<T> = {
  entity: string;
  table: string;
  historyTable: string;
  columns: { [K in keyof T]: string };
};

export interface Repository<T extends { id: string }> {
  get(id: string, options?: { includeDeleted?: boolean }): EntityRecord<T> | null;
  list(options?: { includeDeleted?: boolean }): EntityRecord<T>[];
  create(input: T, options?: { reversible?: boolean }): EntityRecord<T>;
  update(id: string, expectedRevision: number, patch: Partial<Omit<T, "id">>): EntityRecord<T>;
  touch(id: string, expectedRevision: number): EntityRecord<T>;
  revert(id: string, expectedRevision: number, snapshot: EntityRecord<T>): EntityRecord<T>;
  delete(id: string, expectedRevision: number): EntityRecord<T>;
  restoreSnapshot(id: string, expectedRevision: number, snapshot: EntityRecord<T>): EntityRecord<T>;
  restore(id: string, expectedRevision: number, patch: Partial<Omit<T, "id">>): EntityRecord<T>;
}

export type AuditedRepositoryPort<T extends { id: string }> = Repository<T>;
export type RepositoryContext = Pick<ChangeContext, "actor"> & ChangeContext;

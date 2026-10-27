import type { ChangeContext, EntityRecord } from "../../core/models";

export type RepositoryListOptions<T> = {
  includeDeleted?: boolean;
  filters?: Partial<T>;
  ids?: readonly string[];
};

export type RepositoryOperations = {
  get: string;
  list: string;
  create: string;
  update: string;
  touch: string;
  revert: string;
  delete: string;
  restoreSnapshot: string;
  restore: string;
};

export type RepositoryConfig<T> = {
  entity: string;
  table: string;
  historyTable: string;
  columns: { [K in keyof T]: string };
  operations: RepositoryOperations;
};

export interface Repository<T extends { id: string }> {
  get(id: string, options?: { includeDeleted?: boolean }): EntityRecord<T> | null;
  list(options?: RepositoryListOptions<T>): EntityRecord<T>[];
  operation(name: keyof RepositoryOperations): string;
  create(input: T, options?: { reversible?: boolean }): EntityRecord<T>;
  update(id: string, expectedRevision: number, patch: Partial<Omit<T, "id">>): EntityRecord<T>;
  touch(id: string, expectedRevision: number): EntityRecord<T>;
  revert(id: string, expectedRevision: number, snapshot: EntityRecord<T>): EntityRecord<T>;
  delete(id: string, expectedRevision: number): EntityRecord<T>;
  restoreSnapshot(id: string, expectedRevision: number, snapshot: EntityRecord<T>): EntityRecord<T>;
  restore(id: string, expectedRevision: number, patch: Partial<Omit<T, "id">>): EntityRecord<T>;
}

export type AuditedRepositoryPort<T extends { id: string }> = Repository<T>;

export interface RepositoryTelemetry {
  record(event: {
    operation: string;
    entity: string;
    phase: "read" | "write";
    durationMs: number;
    success: boolean;
    error?: unknown;
  }): void;
}
export type RepositoryContext = Pick<ChangeContext, "actor"> & ChangeContext;

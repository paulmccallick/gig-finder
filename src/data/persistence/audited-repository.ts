import type { Database, SQLQueryBindings } from "bun:sqlite";
import { DeletedRecordError, NotFoundError, RevisionConflictError } from "../errors";
import type { ChangeContext, EntityRecord } from "../../core/models";
import type { RepositoryOperations } from "../repositories/audited-port";

export type Scalar = string | number | boolean | null;
export type DataRecord = { id: string };
export type HistoryOperation = "create" | "update" | "delete";
export interface HistorySnapshot<T extends DataRecord> {
  operation: HistoryOperation;
  record: EntityRecord<T>;
}
export type ColumnMap<T> = { [K in keyof T]: string };
export interface RepositoryConfig<T extends DataRecord> { entity: string; table: string; historyTable: string; columns: ColumnMap<T>; operations: RepositoryOperations; booleans?:Array<keyof T> }

const baseColumns = { revision: "revision", isDeleted: "is_deleted", createdAt: "created_at", updatedAt: "updated_at" } as const;
export const quote = (identifier: string) => `"${identifier}"`;
const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");
export const now = (context: ChangeContext) => context.occurredAt ?? new Date().toISOString();
export const id = (prefix:string)=>`${prefix}_${crypto.randomUUID()}`;
const toBinding = (value: Scalar): SQLQueryBindings => typeof value === "boolean" ? Number(value) : value;

export function fromRow<T extends DataRecord>(row: Record<string, unknown>, config: RepositoryConfig<T>): EntityRecord<T> {
  const result: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(config.columns)) result[property] = config.booleans?.includes(property as keyof T)?Boolean(row[column]):row[column];
  result.revision = row.revision;
  result.isDeleted = Boolean(row.is_deleted);
  result.createdAt = row.created_at;
  result.updatedAt = row.updated_at;
  return result as unknown as EntityRecord<T>;
}

export class ReadRepository<T extends DataRecord> {
  constructor(protected readonly database: Database, protected readonly config: RepositoryConfig<T>) {}
  get(recordId: string, options: { includeDeleted?: boolean } = {}): EntityRecord<T> | null {
    const row = this.database.query(`SELECT * FROM ${quote(this.config.table)} WHERE id = ?${options.includeDeleted ? "" : " AND is_deleted = 0"}`).get(recordId) as Record<string, unknown> | null;
    return row ? fromRow(row, this.config) : null;
  }
  operation(name: keyof RepositoryOperations): string { return this.config.operations[name]; }
  list(options: { includeDeleted?: boolean } = {}): EntityRecord<T>[] {
    const rows = this.database.query(`SELECT * FROM ${quote(this.config.table)}${options.includeDeleted ? "" : " WHERE is_deleted = 0"} ORDER BY id`).all() as Record<string, unknown>[];
    return rows.map((row) => fromRow(row, this.config));
  }
}

export class MutationRepository<T extends DataRecord> {
  private readonly reader: ReadRepository<T>;
  constructor(private readonly database: Database, private readonly config: RepositoryConfig<T>, private readonly context: Required<Pick<ChangeContext,"actor">> & ChangeContext, private readonly changeId: string) { this.reader = new ReadRepository(database, config); }
  get(recordId: string, options: { includeDeleted?: boolean } = {}) { return this.reader.get(recordId, options); }
  list(options: { includeDeleted?: boolean } = {}) { return this.reader.list(options); }
  operation(name: keyof RepositoryOperations): string { return this.reader.operation(name); }
  create(input: T, options: { reversible?: boolean } = {}): EntityRecord<T> {
    if (this.get(input.id, { includeDeleted: true })) throw new Error(`${this.config.entity} already exists: ${input.id}`);
    const timestamp = now(this.context);
    const entries = Object.entries(this.config.columns).map(([property, column]) => [column, input[property as keyof T] as Scalar] as const);
    const values = [...entries.map(([, value]) => value), 1, false, timestamp, timestamp];
    const columns = [...entries.map(([column]) => column), ...Object.values(baseColumns)];
    this.database.query(`INSERT INTO ${quote(this.config.table)} (${columns.map(quote).join(", ")}) VALUES (${placeholders(values.length)})`).run(...values.map(toBinding));
    const created = this.get(input.id, { includeDeleted: true })!;
    if (options.reversible) this.snapshot(created, "create");
    return created;
  }
  update(recordId: string, expectedRevision: number, patch: Partial<Omit<T,"id">>): EntityRecord<T> {
    const current = this.requireCurrent(recordId, expectedRevision);
    const patchEntries = Object.entries(patch).map(([property, value]) => {
      const column = this.config.columns[property as keyof T];
      if (!column || property === "id") throw new Error(`Unknown or immutable ${this.config.entity} field: ${property}`);
      return [column, value as Scalar] as const;
    });
    if (patchEntries.length === 0) return current;
    this.snapshot(current, "update");
    const timestamp = now(this.context);
    const assignments = [...patchEntries.map(([column]) => `${quote(column)} = ?`), "revision = revision + 1", "updated_at = ?"];
    const result = this.database.query(`UPDATE ${quote(this.config.table)} SET ${assignments.join(", ")} WHERE id = ? AND revision = ? AND is_deleted = 0`).run(...patchEntries.map(([, value]) => toBinding(value)), timestamp, recordId, expectedRevision);
    if (result.changes !== 1) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, this.get(recordId, { includeDeleted: true })?.revision ?? -1);
    return this.get(recordId)!;
  }
  touch(recordId: string, expectedRevision: number): EntityRecord<T> {
    const current = this.requireCurrent(recordId, expectedRevision);
    this.snapshot(current, "update");
    const timestamp = now(this.context);
    const result = this.database.query(`UPDATE ${quote(this.config.table)} SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND is_deleted = 0`).run(timestamp, recordId, expectedRevision);
    if (result.changes !== 1) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, this.get(recordId, { includeDeleted: true })?.revision ?? -1);
    return this.get(recordId)!;
  }
  revert(recordId: string, expectedRevision: number, snapshot: EntityRecord<T>): EntityRecord<T> {
    const current = this.requireCurrent(recordId, expectedRevision);
    this.snapshot(current, "update");
    const entries = Object.entries(this.config.columns)
      .filter(([property]) => property !== "id")
      .map(([property, column]) => [
        column,
        snapshot[property as keyof T] as Scalar,
      ] as const);
    const timestamp = now(this.context);
    const assignments = [
      ...entries.map(([column]) => `${quote(column)} = ?`),
      "revision = revision + 1",
      "updated_at = ?",
    ];
    const result = this.database.query(
      `UPDATE ${quote(this.config.table)} SET ${assignments.join(", ")} WHERE id = ? AND revision = ? AND is_deleted = 0`,
    ).run(
      ...entries.map(([, value]) => toBinding(value)),
      timestamp,
      recordId,
      expectedRevision,
    );
    if (result.changes !== 1) {
      throw new RevisionConflictError(
        this.config.entity,
        recordId,
        expectedRevision,
        this.get(recordId, { includeDeleted: true })?.revision ?? -1,
      );
    }
    return this.get(recordId)!;
  }
  delete(recordId: string, expectedRevision: number): EntityRecord<T> {
    const current = this.requireCurrent(recordId, expectedRevision);
    this.snapshot(current, "delete");
    const timestamp = now(this.context);
    const result = this.database.query(`UPDATE ${quote(this.config.table)} SET is_deleted = 1, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND is_deleted = 0`).run(timestamp, recordId, expectedRevision);
    if (result.changes !== 1) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, this.get(recordId, { includeDeleted: true })?.revision ?? -1);
    return this.get(recordId, { includeDeleted: true })!;
  }
  restore(recordId: string, expectedRevision: number, patch: Partial<Omit<T,"id">>): EntityRecord<T> {
    const patchEntries = Object.entries(patch).map(([property, value]) => {
      const column = this.config.columns[property as keyof T];
      if (!column || property === "id") throw new Error(`Unknown or immutable ${this.config.entity} field: ${property}`);
      return [column, value as Scalar] as const;
    });
    return this.restoreEntries(recordId, expectedRevision, patchEntries);
  }
  restoreSnapshot(recordId: string, expectedRevision: number, snapshot: EntityRecord<T>): EntityRecord<T> {
    const entries = Object.entries(this.config.columns)
      .filter(([property]) => property !== "id")
      .map(([property, column]) => [
        column,
        snapshot[property as keyof T] as Scalar,
      ] as const);
    return this.restoreEntries(recordId, expectedRevision, entries);
  }
  private restoreEntries(recordId: string, expectedRevision: number, entries: ReadonlyArray<readonly [string, Scalar]>): EntityRecord<T> {
    const current = this.get(recordId, { includeDeleted: true });
    if (!current) throw new NotFoundError(this.config.entity, recordId);
    if (!current.isDeleted) throw new Error(`${this.config.entity} is not deleted: ${recordId}`);
    if (current.revision !== expectedRevision) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, current.revision);
    this.snapshot(current, "update");
    const timestamp = now(this.context);
    const assignments = [...entries.map(([column]) => `${quote(column)} = ?`), "is_deleted = 0", "revision = revision + 1", "updated_at = ?"];
    const result = this.database.query(`UPDATE ${quote(this.config.table)} SET ${assignments.join(", ")} WHERE id = ? AND revision = ? AND is_deleted = 1`).run(...entries.map(([, value]) => toBinding(value)), timestamp, recordId, expectedRevision);
    if (result.changes !== 1) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, this.get(recordId, { includeDeleted: true })?.revision ?? -1);
    return this.get(recordId)!;
  }
  private requireCurrent(recordId: string, expectedRevision: number): EntityRecord<T> {
    const current = this.get(recordId, { includeDeleted: true });
    if (!current) throw new NotFoundError(this.config.entity, recordId);
    if (current.isDeleted) throw new DeletedRecordError(this.config.entity, recordId);
    if (current.revision !== expectedRevision) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, current.revision);
    return current;
  }
  private snapshot(current: EntityRecord<T>, operation: HistoryOperation) {
    const recordEntries = [...Object.entries(this.config.columns).map(([property, column]) => [column, current[property as keyof T] as Scalar] as const), ["revision", current.revision] as const, ["is_deleted", current.isDeleted] as const, ["created_at", current.createdAt] as const, ["updated_at", current.updatedAt] as const];
    const metadata = [["change_id", this.changeId], ["operation", operation], ["recorded_at", now(this.context)], ["recorded_by", this.context.actor]] as const;
    const entries = [...metadata, ...recordEntries];
    this.database.query(`INSERT INTO ${quote(this.config.historyTable)} (${entries.map(([column]) => quote(column)).join(", ")}) VALUES (${placeholders(entries.length)})`).run(...entries.map(([, value]) => toBinding(value as Scalar)));
  }
}

export class AuditedRepository<T extends DataRecord> {
  constructor(private readonly reader: ReadRepository<T>, private readonly writer?: MutationRepository<T>) {}
  get(recordId: string, options: { includeDeleted?: boolean } = {}) { return this.reader.get(recordId, options); }
  list(options: { includeDeleted?: boolean } = {}) { return this.reader.list(options); }
  operation(name: keyof RepositoryOperations): string { return this.reader.operation(name); }
  private mutate() { if (!this.writer) throw new Error("mutation_repository_required"); return this.writer; }
  create(input: T, options: { reversible?: boolean } = {}) { return this.mutate().create(input, options); }
  update(recordId: string, expectedRevision: number, patch: Partial<Omit<T, "id">>) { return this.mutate().update(recordId, expectedRevision, patch); }
  touch(recordId: string, expectedRevision: number) { return this.mutate().touch(recordId, expectedRevision); }
  revert(recordId: string, expectedRevision: number, snapshot: EntityRecord<T>) { return this.mutate().revert(recordId, expectedRevision, snapshot); }
  delete(recordId: string, expectedRevision: number) { return this.mutate().delete(recordId, expectedRevision); }
  restoreSnapshot(recordId: string, expectedRevision: number, snapshot: EntityRecord<T>) { return this.mutate().restoreSnapshot(recordId, expectedRevision, snapshot); }
  restore(recordId: string, expectedRevision: number, patch: Partial<Omit<T, "id">>) { return this.mutate().restore(recordId, expectedRevision, patch); }
}


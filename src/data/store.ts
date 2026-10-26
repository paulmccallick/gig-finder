import type { Database, SQLQueryBindings } from "bun:sqlite";
import { DeletedRecordError, NotFoundError, RevisionConflictError } from "./errors";
import { MutationError } from "../core/errors";
import type { ChangeContext, ChangeResult, EntityRecord, GigData, GigPersonData, InteractionData, InteractionParticipantData, PersonData, RevertedRecord, TaskData } from "../core/models";
import {
  SqliteDocumentReadRepository,
  SqliteDocumentWriteRepository,
} from "./document-store";
import { SqliteApplicationSettingsRepository } from "./settings-store";
import { GigRepository, gigRepositoryConfig } from "./repositories/gig-repository";
import { PersonRepository, personRepositoryConfig } from "./repositories/person-repository";
import { GigPersonRepository, gigPersonRepositoryConfig } from "./repositories/gig-person-repository";
import { TaskRepository, taskRepositoryConfig } from "./repositories/task-repository";
import { InteractionRepository, interactionRepositoryConfig } from "./repositories/interaction-repository";
import { InteractionParticipantRepository, interactionParticipantRepositoryConfig } from "./repositories/interaction-participant-repository";
import type { AuditedRepositoryPort } from "./repositories/audited-port";
import type { ProfileDocumentMaterializer } from "./profile-document-files";
import { candidateProfileId } from "../core/documents";
import type { ManagedDocumentRecord } from "../core/documents";

type Scalar = string | number | boolean | null;
type DataRecord = { id: string };
type HistoryOperation = "create" | "update" | "delete";
interface HistorySnapshot<T extends DataRecord> {
  operation: HistoryOperation;
  record: EntityRecord<T>;
}
type ColumnMap<T> = { [K in keyof T]: string };
interface RepositoryConfig<T extends DataRecord> { entity: string; table: string; historyTable: string; columns: ColumnMap<T>;booleans?:Array<keyof T> }

const baseColumns = { revision: "revision", isDeleted: "is_deleted", createdAt: "created_at", updatedAt: "updated_at" } as const;
const quote = (identifier: string) => `"${identifier}"`;
const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");
const now = (context: ChangeContext) => context.occurredAt ?? new Date().toISOString();
const id = (prefix:string)=>`${prefix}_${crypto.randomUUID()}`;
const toBinding = (value: Scalar): SQLQueryBindings => typeof value === "boolean" ? Number(value) : value;

function fromRow<T extends DataRecord>(row: Record<string, unknown>, config: RepositoryConfig<T>): EntityRecord<T> {
  const result: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(config.columns)) result[property] = config.booleans?.includes(property as keyof T)?Boolean(row[column]):row[column];
  result.revision = row.revision;
  result.isDeleted = Boolean(row.is_deleted);
  result.createdAt = row.created_at;
  result.updatedAt = row.updated_at;
  return result as unknown as EntityRecord<T>;
}

class ReadRepository<T extends DataRecord> {
  constructor(protected readonly database: Database, protected readonly config: RepositoryConfig<T>) {}
  get(recordId: string, options: { includeDeleted?: boolean } = {}): EntityRecord<T> | null {
    const row = this.database.query(`SELECT * FROM ${quote(this.config.table)} WHERE id = ?${options.includeDeleted ? "" : " AND is_deleted = 0"}`).get(recordId) as Record<string, unknown> | null;
    return row ? fromRow(row, this.config) : null;
  }
  list(options: { includeDeleted?: boolean } = {}): EntityRecord<T>[] {
    const rows = this.database.query(`SELECT * FROM ${quote(this.config.table)}${options.includeDeleted ? "" : " WHERE is_deleted = 0"} ORDER BY id`).all() as Record<string, unknown>[];
    return rows.map((row) => fromRow(row, this.config));
  }
}

class MutationRepository<T extends DataRecord> extends ReadRepository<T> {
  constructor(database: Database, config: RepositoryConfig<T>, private readonly context: Required<Pick<ChangeContext,"actor">> & ChangeContext, private readonly changeId: string) { super(database, config); }
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

export class ChangeTransaction {
  readonly gigs: GigRepository; readonly people: PersonRepository; readonly gigPeople: GigPersonRepository; readonly tasks: TaskRepository; readonly interactions: InteractionRepository; readonly interactionParticipants: InteractionParticipantRepository; readonly documents: SqliteDocumentWriteRepository;
  constructor(private readonly database: Database, private readonly context: ChangeContext, readonly changeId: string) {
    this.gigs = new GigRepository(new AuditedRepository(new ReadRepository<GigData>(database, gigRepositoryConfig), new MutationRepository<GigData>(database, gigRepositoryConfig, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId)));
    this.people = new PersonRepository(new AuditedRepository(new ReadRepository<PersonData>(database, personRepositoryConfig), new MutationRepository<PersonData>(database, personRepositoryConfig, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId)));
    this.gigPeople = new GigPersonRepository(new AuditedRepository(new ReadRepository<GigPersonData>(database, gigPersonRepositoryConfig), new MutationRepository<GigPersonData>(database, gigPersonRepositoryConfig, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId)));
    this.tasks = new TaskRepository(new AuditedRepository(new ReadRepository<TaskData>(database, taskRepositoryConfig), new MutationRepository<TaskData>(database, taskRepositoryConfig, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId)));
    this.interactions = new InteractionRepository(new AuditedRepository(new ReadRepository<InteractionData>(database, interactionRepositoryConfig), new MutationRepository<InteractionData>(database, interactionRepositoryConfig, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId)));
    this.interactionParticipants = new InteractionParticipantRepository(new AuditedRepository(new ReadRepository<InteractionParticipantData>(database, interactionParticipantRepositoryConfig), new MutationRepository<InteractionParticipantData>(database, interactionParticipantRepositoryConfig, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId)));
    this.documents = new SqliteDocumentWriteRepository(
      database,
      context,
      changeId,
    );
  }
  recordCreationFingerprint(entityType:string,entityId:string,payloadHash:string):void{
    this.database.query("INSERT INTO creation_idempotency (change_id, entity_type, entity_id, payload_hash) VALUES (?, ?, ?, ?)").run(this.changeId,entityType,entityId,payloadHash);
  }
}

export class AuditedRepository<T extends DataRecord> {
  constructor(private readonly reader: ReadRepository<T>, private readonly writer?: MutationRepository<T>) {}
  get(recordId: string, options: { includeDeleted?: boolean } = {}) { return this.reader.get(recordId, options); }
  list(options: { includeDeleted?: boolean } = {}) { return this.reader.list(options); }
  private mutate() { if (!this.writer) throw new Error("mutation_repository_required"); return this.writer; }
  create(input: T, options: { reversible?: boolean } = {}) { return this.mutate().create(input, options); }
  update(recordId: string, expectedRevision: number, patch: Partial<Omit<T, "id">>) { return this.mutate().update(recordId, expectedRevision, patch); }
  touch(recordId: string, expectedRevision: number) { return this.mutate().touch(recordId, expectedRevision); }
  revert(recordId: string, expectedRevision: number, snapshot: EntityRecord<T>) { return this.mutate().revert(recordId, expectedRevision, snapshot); }
  delete(recordId: string, expectedRevision: number) { return this.mutate().delete(recordId, expectedRevision); }
  restoreSnapshot(recordId: string, expectedRevision: number, snapshot: EntityRecord<T>) { return this.mutate().restoreSnapshot(recordId, expectedRevision, snapshot); }
  restore(recordId: string, expectedRevision: number, patch: Partial<Omit<T, "id">>) { return this.mutate().restore(recordId, expectedRevision, patch); }
}

export class DataStore {
  readonly gigs: AuditedRepositoryPort<GigData>;readonly people:AuditedRepositoryPort<PersonData>;readonly gigPeople:AuditedRepositoryPort<GigPersonData>; readonly tasks: AuditedRepositoryPort<TaskData>; readonly interactions: AuditedRepositoryPort<InteractionData>; readonly interactionParticipants: AuditedRepositoryPort<InteractionParticipantData>; readonly documents: SqliteDocumentReadRepository;readonly settings:SqliteApplicationSettingsRepository;
  constructor(
    private readonly database: Database,
    private readonly profileDocuments?: ProfileDocumentMaterializer,
    private readonly reportMaterializationFailure: (
      error: unknown,
      document: ManagedDocumentRecord,
    ) => void = () => undefined,
  ) { this.gigs = new GigRepository(new AuditedRepository(new ReadRepository<GigData>(database, gigRepositoryConfig)));this.people = new PersonRepository(new AuditedRepository(new ReadRepository<PersonData>(database, personRepositoryConfig)));this.gigPeople = new GigPersonRepository(new AuditedRepository(new ReadRepository<GigPersonData>(database, gigPersonRepositoryConfig))); this.tasks = new TaskRepository(new AuditedRepository(new ReadRepository<TaskData>(database, taskRepositoryConfig))); this.interactions = new InteractionRepository(new AuditedRepository(new ReadRepository<InteractionData>(database, interactionRepositoryConfig))); this.interactionParticipants = new InteractionParticipantRepository(new AuditedRepository(new ReadRepository<InteractionParticipantData>(database, interactionParticipantRepositoryConfig))); this.documents = new SqliteDocumentReadRepository(database);this.settings=new SqliteApplicationSettingsRepository(database); }
  synchronizeProfileDocuments(): void {
    if (!this.profileDocuments) return;
    for (const document of this.documents.list("profile", candidateProfileId)) {
      this.materializeProfileDocument(document);
    }
  }
  hasChange(changeId:string):boolean{return this.database.query("SELECT 1 FROM changes WHERE id = ?").get(changeId)!==null}
  creationFingerprint(changeId:string){const row=this.database.query("SELECT entity_type, entity_id, payload_hash FROM creation_idempotency WHERE change_id = ?").get(changeId) as {entity_type:string;entity_id:string;payload_hash:string}|null;return row?{entityType:row.entity_type,entityId:row.entity_id,payloadHash:row.payload_hash}:null}
  change<T>(context: ChangeContext, action: (transaction: ChangeTransaction) => T): ChangeResult<T> {
    if (!context.actor.trim() || !context.summary.trim()) throw new Error("Change actor and summary are required.");
    const changeId = context.changeId ?? id("chg");
    if (context.changeId) this.assertChangeIdAvailable(changeId);
    const occurredAt = now(context);
    const execute = this.database.transaction(() => {
      this.database.query("INSERT INTO changes (id, occurred_at, actor, source, summary, parent_change_id, status) VALUES (?, ?, ?, ?, ?, ?, 'committed')").run(changeId, occurredAt, context.actor, context.source, context.summary, context.parentChangeId ?? null);
      return action(new ChangeTransaction(this.database, { ...context, occurredAt }, changeId));
    });
    const value = execute();
    this.repairPendingProfileDocuments();
    return { changeId, value };
  }

  private repairPendingProfileDocuments(): void {
    if (!this.profileDocuments) return;
    for (const document of this.documents.listPendingProfileMaterializations()) {
      try {
        this.materializeProfileDocument(document);
      } catch (error) {
        this.reportMaterializationFailure(error, document);
      }
    }
  }

  private materializeProfileDocument(document: ManagedDocumentRecord): void {
    this.profileDocuments?.write(document);
    this.documents.markProfileMaterialized(document.id, document.currentVersion);
  }

  revertChange(
    context: ChangeContext,
    targetChangeId: string,
  ): ChangeResult<RevertedRecord[]> {
    if (context.changeId) this.assertChangeIdAvailable(context.changeId);
    const target = this.database.query("SELECT id FROM changes WHERE id = ?")
      .get(targetChangeId);
    if (!target) {
      throw new MutationError("not_found", `Change not found: ${targetChangeId}`);
    }

    const snapshots = {
      gigs: this.historyRecords<GigData>(targetChangeId, gigRepositoryConfig),
      people: this.historyRecords<PersonData>(targetChangeId, personRepositoryConfig),
      gigPeople: this.historyRecords<GigPersonData>(targetChangeId, gigPersonRepositoryConfig),
      tasks: this.historyRecords<TaskData>(targetChangeId, taskRepositoryConfig),
      interactions: this.historyRecords<InteractionData>(targetChangeId, interactionRepositoryConfig),
      interactionParticipants: this.historyRecords<InteractionParticipantData>(targetChangeId, interactionParticipantRepositoryConfig),
    };
    for(const snapshot of snapshots.interactions){
      if(snapshot.operation!=="create")continue;
      const dependent=this.interactions.list().find(item=>item.supersedesInteractionId===snapshot.record.id);
      if(dependent)throw new MutationError("not_revertible",`Cannot revert interaction ${snapshot.record.id} because active Interaction ${dependent.id} supersedes it.`);
    }
    for(const snapshot of snapshots.interactions){const target=snapshot.record.supersedesInteractionId;if(target&&!this.interactions.get(target))throw new MutationError("not_revertible",`Cannot revert interaction ${snapshot.record.id} because superseded Interaction ${target} is not active.`)}
    if (Object.values(snapshots).every(records => records.length === 0)) {
      throw new MutationError(
        "not_revertible",
        `Change has no reversible updates: ${targetChangeId}`,
      );
    }

    return this.change(
      { ...context, parentChangeId: targetChangeId },
      transaction => [
        ...this.restoreRecords(snapshots.gigs, this.gigs, transaction.gigs, "gig"),
        ...this.restoreRecords(snapshots.people, this.people, transaction.people, "person"),
        ...this.restoreRecords(snapshots.gigPeople, this.gigPeople, transaction.gigPeople, "gig-person"),
        ...this.restoreRecords(snapshots.tasks, this.tasks, transaction.tasks, "task"),
        ...this.restoreRecords(snapshots.interactionParticipants, this.interactionParticipants, transaction.interactionParticipants, "interaction-participant"),
        ...this.restoreRecords(snapshots.interactions, this.interactions, transaction.interactions, "interaction"),
      ],
    );
  }

  private assertChangeIdAvailable(changeId: string) {
    if (this.database.query("SELECT 1 FROM changes WHERE id = ?").get(changeId)) {
      throw new MutationError("duplicate_change", `Change has already been applied: ${changeId}`);
    }
  }

  private historyRecords<T extends DataRecord>(
    changeId: string,
    config: RepositoryConfig<T>,
  ): HistorySnapshot<T>[] {
    const rows = this.database.query(
      `SELECT * FROM ${quote(config.historyTable)} WHERE change_id = ? ORDER BY history_id`,
    ).all(changeId) as Record<string, unknown>[];
    return rows.map(row => ({
      operation: row.operation as HistoryOperation,
      record: fromRow(row, config),
    }));
  }

  private restoreRecords<T extends DataRecord>(
    snapshots: HistorySnapshot<T>[],
    reader: AuditedRepositoryPort<T>,
    writer: AuditedRepositoryPort<T>,
    entity: string,
  ): RevertedRecord[] {
    return snapshots.map(({ operation, record: snapshot }) => {
      const current = reader.get(snapshot.id, { includeDeleted: true });
      const expectedRevision = operation === "create"
        ? snapshot.revision
        : snapshot.revision + 1;
      if (!current || current.revision !== expectedRevision) {
        throw new MutationError(
          "revision_conflict",
          `Cannot revert ${entity} ${snapshot.id} because it is not the immediately preceding revision.`,
        );
      }
      if (operation === "create") {
        if (current.isDeleted) throw new MutationError(
          "revision_conflict",
          `Cannot revert ${entity} ${snapshot.id} because the created record is no longer active.`,
        );
        writer.delete(snapshot.id, current.revision);
      } else if (operation === "delete") {
        if (!current.isDeleted || snapshot.isDeleted) throw new MutationError(
          "revision_conflict",
          `Cannot revert ${entity} ${snapshot.id} because the deleted record state has changed.`,
        );
        writer.restoreSnapshot(snapshot.id, current.revision, snapshot);
      } else if (snapshot.isDeleted) {
        if (current.isDeleted) throw new MutationError(
          "revision_conflict",
          `Cannot revert ${entity} ${snapshot.id} because the restored record is no longer active.`,
        );
        writer.delete(snapshot.id, current.revision);
      } else {
        if (current.isDeleted) throw new MutationError(
          "revision_conflict",
          `Cannot revert ${entity} ${snapshot.id} because the updated record is no longer active.`,
        );
        writer.revert(snapshot.id, current.revision, snapshot);
      }
      return { entity, id: snapshot.id };
    });
  }
}

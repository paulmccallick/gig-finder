import type { Database, SQLQueryBindings } from "bun:sqlite";
import { DeletedRecordError, NotFoundError, RevisionConflictError } from "./errors";
import { MutationError } from "../core/errors";
import type { BusinessEventInput, ChangeContext, ChangeResult, EntityRecord, EventSourceInput, GigData, GigPersonData, MeetingData, MeetingParticipantData, PersonData, RevertedRecord, TaskData } from "../core/models";
import {
  SqliteDocumentReadRepository,
  SqliteDocumentWriteRepository,
} from "./document-store";
import { SqliteApplicationSettingsRepository } from "./settings-store";
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
const gigColumns: ColumnMap<GigData> = { id:"id",company:"company",title:"title",externalJobId:"external_job_id",stage:"stage",outcome:"outcome",statusSummary:"status_summary",lastActivity:"last_activity",nextActionDescription:"next_action_description",nextActionDue:"next_action_due",fitRating:"fit_rating",fitSummary:"fit_summary",payCurrency:"pay_currency",payMinimum:"pay_minimum",payMaximum:"pay_maximum",payPeriod:"pay_period",payNotes:"pay_notes",sourceUrl:"source_url",location:"location",workArrangement:"work_arrangement",postedDate:"posted_date",businessUnitTeam:"business_unit_team",recruiterSource:"recruiter_source",bonus:"bonus",equity:"equity",otherCompensation:"other_compensation",tagsJson:"tags_json",hasJobDescription:"has_job_description",hasInterviewPrep:"has_interview_prep" };
const personColumns:ColumnMap<PersonData>={id:"id",name:"name",company:"company",title:"title",linkedInProfileUrl:"linkedin_profile_url",connectedOn:"connected_on",relationshipType:"relationship_type",relationshipStrength:"relationship_strength",introducedBy:"introduced_by",relationshipNotes:"relationship_notes",priority:"priority",status:"status",lastContacted:"last_contacted",lastContactMethod:"last_contact_method",lastContactSummary:"last_contact_summary",nextAction:"next_action",nextActionDue:"next_action_due",whyInteresting:"why_interesting",notesJson:"notes_json",tagsJson:"tags_json"};
const gigPersonColumns:ColumnMap<GigPersonData>={id:"id",gigId:"gig_id",personId:"person_id",relationship:"relationship",notes:"notes"};
const taskColumns: ColumnMap<TaskData> = { id:"id",title:"title",type:"type",status:"status",priority:"priority",dueDate:"due_date",relatedEntityType:"related_entity_type",relatedEntityId:"related_entity_id",relatedEntityLabel:"related_entity_label",notes:"notes",completedAt:"completed_at" };
const meetingColumns: ColumnMap<MeetingData> = { id:"id",title:"title",startsAt:"starts_at",endsAt:"ends_at",timezone:"timezone",location:"location",description:"description",status:"status",gigId:"gig_id",externalCalendarId:"external_calendar_id",externalEventId:"external_event_id" };
const meetingParticipantColumns: ColumnMap<MeetingParticipantData> = { id:"id",meetingId:"meeting_id",personId:"person_id" };

const configs = {
  gigs: { entity:"gig", table:"gigs", historyTable:"gig_history", columns: gigColumns,booleans:["hasJobDescription","hasInterviewPrep"] } satisfies RepositoryConfig<GigData>,
  people:{entity:"person",table:"people",historyTable:"person_history",columns:personColumns} satisfies RepositoryConfig<PersonData>,
  gigPeople:{entity:"gig-person",table:"gig_people",historyTable:"gig_people_history",columns:gigPersonColumns} satisfies RepositoryConfig<GigPersonData>,
  tasks: { entity:"task", table:"tasks", historyTable:"task_history", columns: taskColumns } satisfies RepositoryConfig<TaskData>,
  meetings: { entity:"meeting", table:"meetings", historyTable:"meeting_history", columns: meetingColumns } satisfies RepositoryConfig<MeetingData>,
  meetingParticipants: { entity:"meeting-participant", table:"meeting_participants", historyTable:"meeting_participant_history", columns: meetingParticipantColumns } satisfies RepositoryConfig<MeetingParticipantData>,
};

const quote = (identifier: string) => `"${identifier}"`;
const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");
const now = (context: ChangeContext) => context.occurredAt ?? new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
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

export class ReadRepository<T extends DataRecord> {
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
  readonly gigs: MutationRepository<GigData>; readonly people:MutationRepository<PersonData>;readonly gigPeople:MutationRepository<GigPersonData>; readonly tasks: MutationRepository<TaskData>; readonly meetings: MutationRepository<MeetingData>; readonly meetingParticipants: MutationRepository<MeetingParticipantData>; readonly documents: SqliteDocumentWriteRepository;
  constructor(private readonly database: Database, private readonly context: ChangeContext, readonly changeId: string) {
    this.gigs = new MutationRepository(database, configs.gigs, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
    this.people=new MutationRepository(database,configs.people,context as Required<Pick<ChangeContext,"actor">>&ChangeContext,changeId);this.gigPeople=new MutationRepository(database,configs.gigPeople,context as Required<Pick<ChangeContext,"actor">>&ChangeContext,changeId);
    this.tasks = new MutationRepository(database, configs.tasks, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
    this.meetings = new MutationRepository(database, configs.meetings, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
    this.meetingParticipants = new MutationRepository(database, configs.meetingParticipants, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
    this.documents = new SqliteDocumentWriteRepository(
      database,
      context,
      changeId,
    );
  }
  recordEvent(input: BusinessEventInput): string {
    const eventId = input.id ?? id("evt");
    this.database.query("INSERT INTO business_events (id, change_id, type, entity_type, entity_id, occurred_at, summary, data_json, supersedes_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(eventId, this.changeId, input.type, input.entityType, input.entityId, input.occurredAt, input.summary, JSON.stringify(input.data ?? {}), input.supersedesEventId ?? null);
    for (const source of input.sources ?? []) this.recordSource(eventId, source);
    return eventId;
  }
  recordSource(eventId: string, source: EventSourceInput): string {
    const sourceId = source.id ?? id("src");
    this.database.query("INSERT INTO event_sources (id, event_id, source_system, external_id, source_timestamp, source_uri, imported_at, content_hash, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sourceId, eventId, source.sourceSystem, source.externalId ?? null, source.sourceTimestamp ?? null, source.sourceUri ?? null, source.importedAt, source.contentHash ?? null, source.excerpt ?? null);
    return sourceId;
  }
}

export class DataStore {
  readonly gigs: ReadRepository<GigData>;readonly people:ReadRepository<PersonData>;readonly gigPeople:ReadRepository<GigPersonData>; readonly tasks: ReadRepository<TaskData>; readonly meetings: ReadRepository<MeetingData>; readonly meetingParticipants: ReadRepository<MeetingParticipantData>; readonly documents: SqliteDocumentReadRepository;readonly settings:SqliteApplicationSettingsRepository;
  constructor(
    private readonly database: Database,
    private readonly profileDocuments?: ProfileDocumentMaterializer,
    private readonly reportMaterializationFailure: (
      error: unknown,
      document: ManagedDocumentRecord,
    ) => void = () => undefined,
  ) { this.gigs = new ReadRepository(database, configs.gigs);this.people=new ReadRepository(database,configs.people);this.gigPeople=new ReadRepository(database,configs.gigPeople); this.tasks = new ReadRepository(database, configs.tasks); this.meetings = new ReadRepository(database, configs.meetings); this.meetingParticipants = new ReadRepository(database, configs.meetingParticipants); this.documents = new SqliteDocumentReadRepository(database);this.settings=new SqliteApplicationSettingsRepository(database); }
  synchronizeProfileDocuments(): void {
    if (!this.profileDocuments) return;
    for (const document of this.documents.list("profile", candidateProfileId)) {
      this.materializeProfileDocument(document);
    }
  }
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
      gigs: this.historyRecords(targetChangeId, configs.gigs),
      people: this.historyRecords(targetChangeId, configs.people),
      gigPeople: this.historyRecords(targetChangeId, configs.gigPeople),
      tasks: this.historyRecords(targetChangeId, configs.tasks),
      meetings: this.historyRecords(targetChangeId, configs.meetings),
      meetingParticipants: this.historyRecords(targetChangeId, configs.meetingParticipants),
    };
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
        ...this.restoreRecords(snapshots.meetings, this.meetings, transaction.meetings, "meeting"),
        ...this.restoreRecords(snapshots.meetingParticipants, this.meetingParticipants, transaction.meetingParticipants, "meeting-participant"),
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
    reader: ReadRepository<T>,
    writer: MutationRepository<T>,
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

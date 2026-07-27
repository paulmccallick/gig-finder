import type { Database, SQLQueryBindings } from "bun:sqlite";
import { DeletedRecordError, NotFoundError, RevisionConflictError } from "./errors";
import { MutationError } from "../../core/src/errors";
import type { BusinessEventInput, ChangeContext, ChangeResult, EntityRecord, EventSourceInput, JobData, JobPersonData, MeetingData, NetworkingContactData, PersonData, RevertedEntity, TaskData } from "../../core/src/models";

type Scalar = string | number | boolean | null;
type DataRecord = { id: string };
type ColumnMap<T> = { [K in keyof T]: string };
interface RepositoryConfig<T extends DataRecord> { entity: string; table: string; historyTable: string; columns: ColumnMap<T>;booleans?:Array<keyof T> }

const baseColumns = { revision: "revision", isDeleted: "is_deleted", createdAt: "created_at", updatedAt: "updated_at" } as const;
const jobColumns: ColumnMap<JobData> = { id:"id",company:"company",title:"title",externalJobId:"external_job_id",stage:"stage",outcome:"outcome",statusSummary:"status_summary",lastActivity:"last_activity",nextActionDescription:"next_action_description",nextActionDue:"next_action_due",fitRating:"fit_rating",fitSummary:"fit_summary",payCurrency:"pay_currency",payMinimum:"pay_minimum",payMaximum:"pay_maximum",payPeriod:"pay_period",payNotes:"pay_notes",sourceUrl:"source_url",location:"location",workArrangement:"work_arrangement",postedDate:"posted_date",businessUnitTeam:"business_unit_team",recruiterSource:"recruiter_source",bonus:"bonus",equity:"equity",otherCompensation:"other_compensation",tagsJson:"tags_json",hasJobDescription:"has_job_description",hasInterviewPrep:"has_interview_prep" };
const personColumns:ColumnMap<PersonData>={id:"id",name:"name",company:"company",title:"title",linkedInProfileUrl:"linkedin_profile_url",connectedOn:"connected_on",hasLocalProfile:"has_local_profile"};
const networkingColumns:ColumnMap<NetworkingContactData>={id:"id",personId:"person_id",relationshipType:"relationship_type",relationshipStrength:"relationship_strength",introducedBy:"introduced_by",relationshipNotes:"relationship_notes",priority:"priority",status:"status",lastContacted:"last_contacted",lastContactMethod:"last_contact_method",lastContactSummary:"last_contact_summary",nextAction:"next_action",nextActionDue:"next_action_due",whyInteresting:"why_interesting",notesJson:"notes_json",tagsJson:"tags_json"};
const jobPersonColumns:ColumnMap<JobPersonData>={id:"id",jobId:"job_id",personId:"person_id",relationship:"relationship",notes:"notes"};
const taskColumns: ColumnMap<TaskData> = { id:"id",title:"title",type:"type",status:"status",priority:"priority",dueDate:"due_date",relatedEntityType:"related_entity_type",relatedEntityId:"related_entity_id",relatedEntityLabel:"related_entity_label",notes:"notes",completedAt:"completed_at" };
const meetingColumns: ColumnMap<MeetingData> = { id:"id",title:"title",startsAt:"starts_at",endsAt:"ends_at",timezone:"timezone",location:"location",description:"description",status:"status",relatedEntityType:"related_entity_type",relatedEntityId:"related_entity_id",externalCalendarId:"external_calendar_id",externalEventId:"external_event_id" };

const configs = {
  jobs: { entity:"job", table:"jobs", historyTable:"job_history", columns: jobColumns,booleans:["hasJobDescription","hasInterviewPrep"] } satisfies RepositoryConfig<JobData>,
  people:{entity:"person",table:"people",historyTable:"person_history",columns:personColumns,booleans:["hasLocalProfile"]} satisfies RepositoryConfig<PersonData>,
  networking:{entity:"networking",table:"networking_contacts",historyTable:"networking_contact_history",columns:networkingColumns} satisfies RepositoryConfig<NetworkingContactData>,
  jobPeople:{entity:"job-person",table:"job_people",historyTable:"job_people_history",columns:jobPersonColumns} satisfies RepositoryConfig<JobPersonData>,
  tasks: { entity:"task", table:"tasks", historyTable:"task_history", columns: taskColumns } satisfies RepositoryConfig<TaskData>,
  meetings: { entity:"meeting", table:"meetings", historyTable:"meeting_history", columns: meetingColumns } satisfies RepositoryConfig<MeetingData>,
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
  create(input: T): EntityRecord<T> {
    if (this.get(input.id, { includeDeleted: true })) throw new Error(`${this.config.entity} already exists: ${input.id}`);
    const timestamp = now(this.context);
    const entries = Object.entries(this.config.columns).map(([property, column]) => [column, input[property as keyof T] as Scalar] as const);
    const values = [...entries.map(([, value]) => value), 1, false, timestamp, timestamp];
    const columns = [...entries.map(([column]) => column), ...Object.values(baseColumns)];
    this.database.query(`INSERT INTO ${quote(this.config.table)} (${columns.map(quote).join(", ")}) VALUES (${placeholders(values.length)})`).run(...values.map(toBinding));
    return this.get(input.id, { includeDeleted: true })!;
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
  delete(recordId: string, expectedRevision: number): EntityRecord<T> {
    const current = this.requireCurrent(recordId, expectedRevision);
    this.snapshot(current, "delete");
    const timestamp = now(this.context);
    const result = this.database.query(`UPDATE ${quote(this.config.table)} SET is_deleted = 1, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND is_deleted = 0`).run(timestamp, recordId, expectedRevision);
    if (result.changes !== 1) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, this.get(recordId, { includeDeleted: true })?.revision ?? -1);
    return this.get(recordId, { includeDeleted: true })!;
  }
  restore(recordId: string, expectedRevision: number, patch: Partial<Omit<T,"id">>): EntityRecord<T> {
    const current = this.get(recordId, { includeDeleted: true });
    if (!current) throw new NotFoundError(this.config.entity, recordId);
    if (!current.isDeleted) throw new Error(`${this.config.entity} is not deleted: ${recordId}`);
    if (current.revision !== expectedRevision) throw new RevisionConflictError(this.config.entity, recordId, expectedRevision, current.revision);
    const patchEntries = Object.entries(patch).map(([property, value]) => {
      const column = this.config.columns[property as keyof T];
      if (!column || property === "id") throw new Error(`Unknown or immutable ${this.config.entity} field: ${property}`);
      return [column, value as Scalar] as const;
    });
    this.snapshot(current, "update");
    const timestamp = now(this.context);
    const assignments = [...patchEntries.map(([column]) => `${quote(column)} = ?`), "is_deleted = 0", "revision = revision + 1", "updated_at = ?"];
    const result = this.database.query(`UPDATE ${quote(this.config.table)} SET ${assignments.join(", ")} WHERE id = ? AND revision = ? AND is_deleted = 1`).run(...patchEntries.map(([, value]) => toBinding(value)), timestamp, recordId, expectedRevision);
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
  private snapshot(current: EntityRecord<T>, operation: "update" | "delete") {
    const recordEntries = [...Object.entries(this.config.columns).map(([property, column]) => [column, current[property as keyof T] as Scalar] as const), ["revision", current.revision] as const, ["is_deleted", current.isDeleted] as const, ["created_at", current.createdAt] as const, ["updated_at", current.updatedAt] as const];
    const metadata = [["change_id", this.changeId], ["operation", operation], ["recorded_at", now(this.context)], ["recorded_by", this.context.actor]] as const;
    const entries = [...metadata, ...recordEntries];
    this.database.query(`INSERT INTO ${quote(this.config.historyTable)} (${entries.map(([column]) => quote(column)).join(", ")}) VALUES (${placeholders(entries.length)})`).run(...entries.map(([, value]) => toBinding(value as Scalar)));
  }
}

export class ChangeTransaction {
  readonly jobs: MutationRepository<JobData>; readonly people:MutationRepository<PersonData>;readonly networking:MutationRepository<NetworkingContactData>;readonly jobPeople:MutationRepository<JobPersonData>; readonly tasks: MutationRepository<TaskData>; readonly meetings: MutationRepository<MeetingData>;
  constructor(private readonly database: Database, private readonly context: ChangeContext, readonly changeId: string) {
    this.jobs = new MutationRepository(database, configs.jobs, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
    this.people=new MutationRepository(database,configs.people,context as Required<Pick<ChangeContext,"actor">>&ChangeContext,changeId);this.networking=new MutationRepository(database,configs.networking,context as Required<Pick<ChangeContext,"actor">>&ChangeContext,changeId);this.jobPeople=new MutationRepository(database,configs.jobPeople,context as Required<Pick<ChangeContext,"actor">>&ChangeContext,changeId);
    this.tasks = new MutationRepository(database, configs.tasks, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
    this.meetings = new MutationRepository(database, configs.meetings, context as Required<Pick<ChangeContext,"actor">> & ChangeContext, changeId);
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
  readonly jobs: ReadRepository<JobData>;readonly people:ReadRepository<PersonData>;readonly networking:ReadRepository<NetworkingContactData>;readonly jobPeople:ReadRepository<JobPersonData>; readonly tasks: ReadRepository<TaskData>; readonly meetings: ReadRepository<MeetingData>;
  constructor(private readonly database: Database) { this.jobs = new ReadRepository(database, configs.jobs);this.people=new ReadRepository(database,configs.people);this.networking=new ReadRepository(database,configs.networking);this.jobPeople=new ReadRepository(database,configs.jobPeople); this.tasks = new ReadRepository(database, configs.tasks); this.meetings = new ReadRepository(database, configs.meetings); }
  change<T>(context: ChangeContext, action: (transaction: ChangeTransaction) => T): ChangeResult<T> {
    if (!context.actor.trim() || !context.summary.trim()) throw new Error("Change actor and summary are required.");
    const changeId = context.changeId ?? id("chg");
    if (context.changeId && this.database.query("SELECT 1 FROM changes WHERE id = ?").get(changeId)) {
      throw new MutationError("duplicate_change", `Change has already been applied: ${changeId}`);
    }
    const occurredAt = now(context);
    const execute = this.database.transaction(() => {
      this.database.query("INSERT INTO changes (id, occurred_at, actor, source, summary, parent_change_id, status) VALUES (?, ?, ?, ?, ?, ?, 'committed')").run(changeId, occurredAt, context.actor, context.source, context.summary, context.parentChangeId ?? null);
      return action(new ChangeTransaction(this.database, { ...context, occurredAt }, changeId));
    });
    return { changeId, value: execute() };
  }

  revertAgentChange(
    context: ChangeContext,
    targetChangeId: string,
  ): ChangeResult<RevertedEntity[]> {
    if (context.changeId && this.database.query(
      "SELECT 1 FROM changes WHERE id = ?",
    ).get(context.changeId)) {
      throw new MutationError(
        "duplicate_change",
        `Change has already been applied: ${context.changeId}`,
      );
    }
    const target = this.database.query(
      "SELECT id, source FROM changes WHERE id = ?",
    ).get(targetChangeId) as { id: string; source: string } | null;
    if (!target) {
      throw new MutationError("not_found", `Agent change not found: ${targetChangeId}`);
    }
    if (target.source !== "agent" || !target.id.startsWith("agent-tool:")) {
      throw new MutationError(
        "not_revertible",
        `Change is not an agent update: ${targetChangeId}`,
      );
    }

    const snapshots = [
      ...this.historyRecords(targetChangeId, configs.jobs)
        .map(record => ({ entity: "job" as const, record })),
      ...this.historyRecords(targetChangeId, configs.people)
        .map(record => ({ entity: "person" as const, record })),
      ...this.historyRecords(targetChangeId, configs.networking)
        .map(record => ({ entity: "networking" as const, record })),
    ];
    if (snapshots.length === 0) {
      throw new MutationError(
        "not_revertible",
        `Agent change has no reversible job or contact updates: ${targetChangeId}`,
      );
    }
    for (const snapshot of snapshots) {
      const current = snapshot.entity === "job"
        ? this.jobs.get(snapshot.record.id, { includeDeleted: true })
        : snapshot.entity === "person"
          ? this.people.get(snapshot.record.id, { includeDeleted: true })
          : this.networking.get(snapshot.record.id, { includeDeleted: true });
      if (!current || current.revision !== snapshot.record.revision + 1) {
        throw new MutationError(
          "revision_conflict",
          `Cannot revert ${snapshot.entity} ${snapshot.record.id} because it has a later revision.`,
        );
      }
    }

    return this.change(
      { ...context, parentChangeId: targetChangeId },
      transaction => snapshots.map(snapshot => {
        if (snapshot.entity === "job") {
          const current = this.jobs.get(snapshot.record.id, { includeDeleted: true })!;
          const { id: recordId, revision: _, isDeleted: __, createdAt: ___, updatedAt: ____, ...data } = snapshot.record;
          transaction.jobs.update(recordId, current.revision, data);
          return { entity: snapshot.entity, id: recordId };
        }
        if (snapshot.entity === "person") {
          const current = this.people.get(snapshot.record.id, { includeDeleted: true })!;
          const { id: recordId, revision: _, isDeleted: __, createdAt: ___, updatedAt: ____, ...data } = snapshot.record;
          transaction.people.update(recordId, current.revision, data);
          return { entity: snapshot.entity, id: recordId };
        }
        const current = this.networking.get(snapshot.record.id, { includeDeleted: true })!;
        const { id: recordId, revision: _, isDeleted: __, createdAt: ___, updatedAt: ____, ...data } = snapshot.record;
        transaction.networking.update(recordId, current.revision, data);
        return { entity: snapshot.entity, id: recordId };
      }),
    );
  }

  private historyRecords<T extends DataRecord>(
    changeId: string,
    config: RepositoryConfig<T>,
  ): EntityRecord<T>[] {
    const rows = this.database.query(
      `SELECT * FROM ${quote(config.historyTable)} WHERE change_id = ? ORDER BY history_id`,
    ).all(changeId) as Record<string, unknown>[];
    return rows.map(row => fromRow(row, config));
  }
}

import type { Database } from "bun:sqlite";
import { MutationError } from "../core/errors";
import { AuditedRepository, fromRow, now, id, quote, type DataRecord, type HistoryOperation, type HistorySnapshot, type RepositoryConfig } from "./persistence/audited-repository";
import { ChangeTransaction } from "./change-transaction";
import { ReadRepository } from "./persistence/audited-repository";
import { GigRepository, gigRepositoryConfig } from "./repositories/gig-repository";
import { PersonRepository, personRepositoryConfig } from "./repositories/person-repository";
import { GigPersonRepository, gigPersonRepositoryConfig } from "./repositories/gig-person-repository";
import { TaskRepository, taskRepositoryConfig } from "./repositories/task-repository";
import { InteractionRepository, interactionRepositoryConfig } from "./repositories/interaction-repository";
import { InteractionParticipantRepository, interactionParticipantRepositoryConfig } from "./repositories/interaction-participant-repository";
import type { ChangeContext, ChangeResult, EntityRecord, GigData, GigPersonData, InteractionData, InteractionParticipantData, PersonData, RevertedRecord, TaskData } from "../core/models";
import {
  SqliteDocumentReadRepository,
  SqliteDocumentWriteRepository,
} from "./document-store";
import { SqliteApplicationSettingsRepository } from "./settings-store";
import type { AuditedRepositoryPort } from "./repositories/audited-port";
import type { ProfileDocumentMaterializer } from "./profile-document-files";
import { candidateProfileId } from "../core/documents";
import type { ManagedDocumentRecord } from "../core/documents";

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

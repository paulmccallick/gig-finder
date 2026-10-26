import type { Database } from "bun:sqlite";
import type { ChangeContext, GigData, GigPersonData, InteractionData, InteractionParticipantData, PersonData, TaskData } from "../core/models";
import { AuditedRepository, MutationRepository, ReadRepository } from "./persistence/audited-repository";
import { SqliteDocumentWriteRepository } from "./document-store";
import { GigRepository, gigRepositoryConfig } from "./repositories/gig-repository";
import { PersonRepository, personRepositoryConfig } from "./repositories/person-repository";
import { GigPersonRepository, gigPersonRepositoryConfig } from "./repositories/gig-person-repository";
import { TaskRepository, taskRepositoryConfig } from "./repositories/task-repository";
import { InteractionRepository, interactionRepositoryConfig } from "./repositories/interaction-repository";
import { InteractionParticipantRepository, interactionParticipantRepositoryConfig } from "./repositories/interaction-participant-repository";

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


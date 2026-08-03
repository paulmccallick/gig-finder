import type { AuditQuery } from "./services";
import type { BusinessEventInput, ChangeContext, ChangeResult, EntityRecord, GigData, GigPersonData, MeetingData, MeetingParticipantData, PersonData, RevertedRecord, TaskData } from "./models";
import type {
  DocumentLinkEntityType,
  ManagedDocumentData,
  ManagedDocumentRecord,
  ManagedDocumentVersionData,
} from "./documents";

export interface ReadRepository<T extends {id:string}>{get(id:string,options?:{includeDeleted?:boolean}):EntityRecord<T>|null;list(options?:{includeDeleted?:boolean}):EntityRecord<T>[]}
export interface WriteRepository<T extends {id:string}> extends ReadRepository<T>{create(record:T):EntityRecord<T>;update(id:string,revision:number,patch:Partial<Omit<T,"id">>):EntityRecord<T>;touch(id:string,revision:number):EntityRecord<T>;delete(id:string,revision:number):EntityRecord<T>;restore(id:string,revision:number,patch:Partial<Omit<T,"id">>):EntityRecord<T>}
export interface ReversibleCreateRepository<T extends {id:string}> extends WriteRepository<T>{create(record:T,options?:{reversible?:boolean}):EntityRecord<T>}
export interface DocumentReadRepository {
  get(id: string): ManagedDocumentRecord | null;
  list(entityType: DocumentLinkEntityType, entityId: string): ManagedDocumentRecord[];
  listVersions(id: string): ManagedDocumentVersionData[];
}
export interface DocumentWriteRepository extends DocumentReadRepository {
  create(input: {
    document: ManagedDocumentData;
    content: string;
    contentHash: string;
  }): ManagedDocumentRecord;
  addVersion(input: {
    documentId: string;
    expectedVersion: number;
    content: string;
    contentHash: string;
    changeSummary: string;
  }): ManagedDocumentRecord;
}
export interface ApplicationSettingsRepository {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
export interface UnitOfWork{gigs:WriteRepository<GigData>;people:WriteRepository<PersonData>;gigPeople:WriteRepository<GigPersonData>;tasks:WriteRepository<TaskData>;meetings:WriteRepository<MeetingData>;meetingParticipants:ReversibleCreateRepository<MeetingParticipantData>;documents:DocumentWriteRepository;recordEvent(input:BusinessEventInput):string}
export interface Persistence{gigs:ReadRepository<GigData>;people:ReadRepository<PersonData>;gigPeople:ReadRepository<GigPersonData>;tasks:ReadRepository<TaskData>;meetings:ReadRepository<MeetingData>;meetingParticipants:ReadRepository<MeetingParticipantData>;documents:DocumentReadRepository;settings:ApplicationSettingsRepository;change<T>(context:ChangeContext,action:(transaction:UnitOfWork)=>T):ChangeResult<T>;revertChange(context:ChangeContext,targetChangeId:string):ChangeResult<RevertedRecord[]>}
export interface AuditPort{query(query:AuditQuery):Record<string,unknown>|Record<string,unknown>[]|null}
export interface ArtifactPort{jobDescription(gigId:string):Promise<string>;interviewPrep(gigId:string):Promise<{name:string;content:string}[]>;jobDescriptionExists(gigId:string):Promise<boolean>;interviewPrepExists(gigId:string):Promise<boolean>;verify(expectations:{gigs:{id:string;hasJobDescription:boolean;hasInterviewPrep:boolean}[]}):Promise<ArtifactVerification>}
export interface ArtifactVerification{ok:boolean;errors:string[];unregistered:string[]}

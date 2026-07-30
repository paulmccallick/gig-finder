import type { AuditQuery } from "./services";
import type { BusinessEventInput, ChangeContext, ChangeResult, EntityRecord, JobData, JobPersonData, MeetingData, NetworkingContactData, PersonData, RevertedRecord, TaskData } from "./models";
import type {
  DocumentLinkEntityType,
  ManagedDocumentData,
  ManagedDocumentRecord,
  ManagedDocumentVersionData,
} from "./documents";

export interface ReadRepository<T extends {id:string}>{get(id:string,options?:{includeDeleted?:boolean}):EntityRecord<T>|null;list(options?:{includeDeleted?:boolean}):EntityRecord<T>[]}
export interface WriteRepository<T extends {id:string}> extends ReadRepository<T>{create(record:T):EntityRecord<T>;update(id:string,revision:number,patch:Partial<Omit<T,"id">>):EntityRecord<T>;delete(id:string,revision:number):EntityRecord<T>;restore(id:string,revision:number,patch:Partial<Omit<T,"id">>):EntityRecord<T>}
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
export interface UnitOfWork{jobs:WriteRepository<JobData>;people:WriteRepository<PersonData>;networking:WriteRepository<NetworkingContactData>;jobPeople:WriteRepository<JobPersonData>;tasks:WriteRepository<TaskData>;meetings:WriteRepository<MeetingData>;documents:DocumentWriteRepository;recordEvent(input:BusinessEventInput):string}
export interface Persistence{jobs:ReadRepository<JobData>;people:ReadRepository<PersonData>;networking:ReadRepository<NetworkingContactData>;jobPeople:ReadRepository<JobPersonData>;tasks:ReadRepository<TaskData>;meetings:ReadRepository<MeetingData>;documents:DocumentReadRepository;change<T>(context:ChangeContext,action:(transaction:UnitOfWork)=>T):ChangeResult<T>;revertChange(context:ChangeContext,targetChangeId:string):ChangeResult<RevertedRecord[]>}
export interface AuditPort{query(query:AuditQuery):Record<string,unknown>|Record<string,unknown>[]|null}
export interface ArtifactPort{jobDescription(jobId:string):Promise<string>;interviewPrep(jobId:string):Promise<{name:string;content:string}[]>;jobDescriptionExists(jobId:string):Promise<boolean>;interviewPrepExists(jobId:string):Promise<boolean>;verify(expectations:{jobs:{id:string;hasJobDescription:boolean;hasInterviewPrep:boolean}[]}):Promise<ArtifactVerification>}
export interface ArtifactVerification{ok:boolean;errors:string[];unregistered:string[]}

import type { ArtifactPort, AuditPort, Persistence } from "./ports";
import type { ChangeContext, EntityRecord, JobData, NetworkingContactData, PersonData, TaskData } from "./models";
import { fitRatings, outcomes, pipelineStages, type Job, type JobRole } from "./jobs";
import { DomainValidationError } from "./errors";
import { contactPriorities, contactStatuses, type NetworkContact } from "./network";
import { taskPriorities, taskStatuses, taskTypes, type TaskRecord } from "./tasks";
import {
  jobUpdateSchema,
  networkingContactUpdateSchema,
  type JobUpdate,
  type NetworkingContactUpdate,
} from "./update-contracts";
import { ChangeExecutor, type MutationOptions } from "./changes";

export interface JobTouchInput { date:string;stage:Job["stage"];summary:string;outcome?:Job["outcome"];nextAction?:string|null;due?:string|null }
export interface ContactTouchInput { date:string;status:NetworkContact["status"];method:string;summary:string;nextAction?:string|null;due?:string|null }
export interface TaskCreateInput { id:string;title:string;type:TaskRecord["type"];priority?:TaskRecord["priority"];dueDate:string|null;relatedEntity:TaskRecord["relatedEntity"];notes?:string|null;date:string }

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const assertDate = (value: unknown, label: string, nullable = false) => {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !datePattern.test(value)) throw new DomainValidationError(`${label} must use YYYY-MM-DD.`);
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function deepPatch<T>(current: T, patch: unknown): T {
  if (!isRecord(current) || !isRecord(patch)) return patch as T;
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) result[key] = isRecord(value) && isRecord(result[key]) ? deepPatch(result[key], value) : value;
  return result as T;
}

function validateJob(job: Job) {
  if (!job.id || !job.company || !job.title || !job.statusSummary) throw new DomainValidationError("Job id, company, title, and status summary are required.");
  if (!pipelineStages.includes(job.stage)) throw new DomainValidationError(`Job ${job.id} has an unknown stage: ${job.stage}.`);
  if (!outcomes.includes(job.outcome)) throw new DomainValidationError(`Job ${job.id} has an unknown outcome: ${job.outcome}.`);
  if (!fitRatings.includes(job.fit.rating)) throw new DomainValidationError(`Job ${job.id} has an invalid fit rating: ${job.fit.rating}.`);
  if (job.stage === "closed" && job.outcome === "pending") {
    throw new DomainValidationError(`Job ${job.id} cannot be closed while its outcome is pending.`);
  }
  if (job.stage !== "closed" && job.outcome !== "pending") {
    throw new DomainValidationError(`Job ${job.id} must remain pending until its stage is closed.`);
  }
  assertDate(job.lastActivity, `${job.id}.lastActivity`);
  if (job.nextAction) {
    if (!job.nextAction.description?.trim()) {
      throw new DomainValidationError(`Job ${job.id} next action requires a description.`);
    }
    assertDate(job.nextAction.due, `${job.id}.nextAction.due`, true);
  }
  if (job.stage === "closed" && job.nextAction !== null) throw new DomainValidationError(`${job.id} is closed but still has a next action.`);
  if (job.payRange && (!job.payRange.currency || !job.payRange.period)) {
    throw new DomainValidationError(`Job ${job.id} pay range requires currency and period.`);
  }
  if (job.payRange?.minimum !== null && job.payRange?.maximum !== null && job.payRange && job.payRange.minimum! > job.payRange.maximum!) throw new DomainValidationError(`${job.id} has an inverted pay range.`);
}

function jobFromData(r: JobData): Job {
  return {id:r.id,company:r.company,title:r.title,jobId:r.externalJobId,roleDirectory:`artifacts/jobs/${r.id}`,stage:r.stage as Job["stage"],outcome:r.outcome as Job["outcome"],statusSummary:r.statusSummary,lastActivity:r.lastActivity,nextAction:r.nextActionDescription?{description:r.nextActionDescription,due:r.nextActionDue}:null,fit:{rating:r.fitRating as Job["fit"]["rating"],summary:r.fitSummary},payRange:r.payCurrency||r.payMinimum!==null||r.payMaximum!==null||r.payPeriod||r.payNotes?{currency:(r.payCurrency??"USD") as "USD",minimum:r.payMinimum,maximum:r.payMaximum,period:(r.payPeriod??"year") as "hour"|"year",notes:r.payNotes}:null,sourceUrl:r.sourceUrl,tags:JSON.parse(r.tagsJson),hasJobDescription:r.hasJobDescription,hasInterviewPrep:r.hasInterviewPrep,location:r.location,workArrangement:r.workArrangement,postedDate:r.postedDate,businessUnitTeam:r.businessUnitTeam,recruiterSource:r.recruiterSource,bonus:r.bonus,equity:r.equity,otherCompensation:r.otherCompensation};
}
function jobToData(r: JobRole): JobData {
  return {id:r.id,company:r.company,title:r.title,externalJobId:r.jobId??null,stage:r.stage,outcome:r.outcome,statusSummary:r.statusSummary,lastActivity:r.lastActivity,nextActionDescription:r.nextAction?.description??null,nextActionDue:r.nextAction?.due??null,fitRating:r.fit.rating,fitSummary:r.fit.summary??null,payCurrency:r.payRange?.currency??null,payMinimum:r.payRange?.minimum??null,payMaximum:r.payRange?.maximum??null,payPeriod:r.payRange?.period??null,payNotes:r.payRange?.notes??null,sourceUrl:r.sourceUrl??null,location:r.location??null,workArrangement:r.workArrangement??null,postedDate:r.postedDate??null,businessUnitTeam:r.businessUnitTeam??null,recruiterSource:r.recruiterSource??null,bonus:r.bonus??null,equity:r.equity??null,otherCompensation:r.otherCompensation??null,tagsJson:JSON.stringify(r.tags??[]),hasJobDescription:r.hasJobDescription??false,hasInterviewPrep:r.hasInterviewPrep??false};
}

function contactFromData(c: NetworkingContactData & {person:PersonData;createdAt:string;updatedAt:string}): NetworkContact {
  return {id:c.id,name:c.person.name,company:c.person.company,title:c.person.title,linkedInProfileUrl:c.person.linkedInProfileUrl,profileStatus:c.person.linkedInProfileUrl?"verified":"missing",connectedOn:c.person.connectedOn,hasLocalProfile:c.person.hasLocalProfile,relationship:{type:c.relationshipType,strength:c.relationshipStrength as NetworkContact["relationship"]["strength"],introducedBy:c.introducedBy,notes:c.relationshipNotes},priority:c.priority as NetworkContact["priority"],status:c.status as NetworkContact["status"],outreach:{lastContacted:c.lastContacted,lastContactMethod:c.lastContactMethod,lastContactSummary:c.lastContactSummary,nextAction:c.nextAction,nextActionDue:c.nextActionDue},whyInteresting:c.whyInteresting,notes:JSON.parse(c.notesJson),tags:JSON.parse(c.tagsJson),source:{files:[]},createdAt:c.createdAt.slice(0,10),updatedAt:c.updatedAt.slice(0,10)};
}
function validateContact(c: NetworkContact) {
  if (!c.id || !c.name) throw new DomainValidationError("Contact id and name are required.");
  if (!contactPriorities.includes(c.priority) || !contactStatuses.includes(c.status)) throw new DomainValidationError(`${c.id} has an invalid priority or status.`);
  for (const [value,label] of [[c.createdAt,`${c.id}.createdAt`],[c.updatedAt,`${c.id}.updatedAt`],[c.connectedOn,`${c.id}.connectedOn`],[c.outreach.lastContacted,`${c.id}.outreach.lastContacted`],[c.outreach.nextActionDue,`${c.id}.outreach.nextActionDue`]] as const) assertDate(value,label,true);
  if (c.profileStatus==="verified"&&!c.linkedInProfileUrl?.match(/^https:\/\/(www\.)?linkedin\.com\/in\//)) throw new DomainValidationError(`${c.id} is verified without a LinkedIn profile URL.`);
  if (c.outreach.nextActionDue&&!c.outreach.nextAction) throw new DomainValidationError(`${c.id} has a next-action due date without a next action.`);
}
const personData=(c:NetworkContact):PersonData=>({id:c.id,name:c.name,company:c.company,title:c.title,linkedInProfileUrl:c.linkedInProfileUrl,connectedOn:c.connectedOn,hasLocalProfile:c.hasLocalProfile??false});
const networkingData=(c:NetworkContact):NetworkingContactData=>({id:c.id,personId:c.id,relationshipType:c.relationship.type,relationshipStrength:c.relationship.strength,introducedBy:c.relationship.introducedBy,relationshipNotes:c.relationship.notes,priority:c.priority,status:c.status,lastContacted:c.outreach.lastContacted,lastContactMethod:c.outreach.lastContactMethod,lastContactSummary:c.outreach.lastContactSummary,nextAction:c.outreach.nextAction,nextActionDue:c.outreach.nextActionDue,whyInteresting:c.whyInteresting,notesJson:JSON.stringify(c.notes),tagsJson:JSON.stringify(c.tags)});
const taskFromData=(t:TaskData&{createdAt:string;updatedAt:string}):TaskRecord=>({id:t.id,title:t.title,type:t.type as TaskRecord["type"],status:t.status as TaskRecord["status"],priority:t.priority as TaskRecord["priority"],dueDate:t.dueDate,relatedEntity:{type:t.relatedEntityType as TaskRecord["relatedEntity"]["type"],id:t.relatedEntityId,label:t.relatedEntityLabel},notes:t.notes,createdAt:t.createdAt.slice(0,10),updatedAt:t.updatedAt.slice(0,10),completedAt:t.completedAt});
const taskData=(t:TaskRecord):TaskData=>({id:t.id,title:t.title,type:t.type,status:t.status,priority:t.priority,dueDate:t.dueDate,relatedEntityType:t.relatedEntity.type,relatedEntityId:t.relatedEntity.id,relatedEntityLabel:t.relatedEntity.label,notes:t.notes,completedAt:t.completedAt});
function validateTask(t:TaskRecord){if(!t.id||!t.title)throw new Error("Task id and title are required.");if(!taskTypes.includes(t.type)||!taskStatuses.includes(t.status)||!taskPriorities.includes(t.priority))throw new Error(`${t.id} has an invalid type, status, or priority.`);assertDate(t.dueDate,`${t.id}.dueDate`,true)}

export class JobDomainService {
  constructor(private p:Persistence,private artifacts:ArtifactPort,private changes:ChangeExecutor){}
  get(id:string){const r=this.p.jobs.get(id);return r?jobFromData(r):null}
  list(){return this.p.jobs.list().map(jobFromData)}
  create(context:ChangeContext,job:JobRole,options:MutationOptions={}){const complete=jobFromData(jobToData(job));validateJob(complete);if(!options.dryRun)this.p.change(context,u=>u.jobs.create(jobToData(complete)));return complete}
  update(context:ChangeContext,id:string,patch:JobUpdate,options:MutationOptions={}){const validatedPatch=jobUpdateSchema.parse(patch);const current=this.get(id);if(!current)throw new Error(`Job not found: ${id}`);const updated=deepPatch(current,validatedPatch);validateJob(updated);const raw=this.p.jobs.get(id)!;const{id:_,...data}=jobToData(updated);return this.changes.execute(context,updated,options,u=>jobFromData(u.jobs.update(id,raw.revision,data)))}
  touch(context:ChangeContext,id:string,input:JobTouchInput,options:MutationOptions={}){return this.update(context,id,{lastActivity:input.date,stage:input.stage,statusSummary:input.summary,...(input.outcome!==undefined?{outcome:input.outcome}:{}),...(input.stage==="closed"?{nextAction:null}:input.nextAction!==undefined||input.due!==undefined?{nextAction:input.nextAction?{description:input.nextAction,due:input.due??null}:null}:{})},options).record}
  async description(id:string){const job=this.get(id);if(!job)throw new Error(`Job not found: ${id}`);return job.hasJobDescription?this.artifacts.jobDescription(id):null}
  async prep(id:string){const job=this.get(id);if(!job)throw new Error(`Job not found: ${id}`);return job.hasInterviewPrep?this.artifacts.interviewPrep(id):[]}
}

export class ContactDomainService {
  constructor(private p:Persistence,private changes:ChangeExecutor){}
  get(id:string){const c=this.p.networking.get(id);if(!c)return null;const person=this.p.people.get(c.personId);if(!person)throw new Error(`Contact ${id} references missing person ${c.personId}`);return contactFromData({...c,person})}
  personId(id:string){return this.p.networking.get(id)?.personId??null}
  list(){return this.p.networking.list().map(c=>{const person=this.p.people.get(c.personId);if(!person)throw new Error(`Contact ${c.id} references missing person ${c.personId}`);return contactFromData({...c,person})})}
  create(context:ChangeContext,c:NetworkContact,options:MutationOptions={}){validateContact(c);if(!options.dryRun)this.p.change(context,u=>{u.people.create(personData(c));u.networking.create(networkingData(c))});return c}
  update(context:ChangeContext,id:string,patch:NetworkingContactUpdate,options:MutationOptions={}){const validatedPatch=networkingContactUpdateSchema.parse(patch);const current=this.get(id);if(!current)throw new Error(`Contact not found: ${id}`);const candidate=deepPatch(current,validatedPatch);const updated={...candidate,profileStatus:candidate.linkedInProfileUrl?"verified" as const:"missing" as const};validateContact(updated);const raw=this.p.networking.get(id)!,person=this.p.people.get(raw.personId)!;const pd=personData(updated),nd=networkingData(updated);const{id:_,...pp}=pd,{id:__,...np}=nd;return this.changes.execute(context,updated,options,u=>{const persistedPerson=u.people.update(person.id,person.revision,pp);const persistedNetworking=u.networking.update(id,raw.revision,np);return contactFromData({...persistedNetworking,person:persistedPerson})})}
  touch(context:ChangeContext,id:string,input:ContactTouchInput,options:MutationOptions={}){return this.update(context,id,{status:input.status,outreach:{lastContacted:input.date,lastContactMethod:input.method,lastContactSummary:input.summary,nextAction:input.nextAction??null,nextActionDue:input.due??null}},options).record}
}

export class TaskDomainService {
  constructor(private p:Persistence){}
  get(id:string){const r=this.p.tasks.get(id);return r?taskFromData(r):null}
  list(){return this.p.tasks.list().map(taskFromData)}
  create(context:ChangeContext,t:TaskRecord,options:MutationOptions={}){validateTask(t);if(!options.dryRun)this.p.change(context,u=>u.tasks.create(taskData(t)));return t}
  createNew(context:ChangeContext,input:TaskCreateInput,options:MutationOptions={}){return this.create(context,{id:input.id,title:input.title,type:input.type,status:"open",priority:input.priority??"medium",dueDate:input.dueDate,relatedEntity:input.relatedEntity,notes:input.notes??null,createdAt:input.date,updatedAt:input.date,completedAt:null},options)}
  update(context:ChangeContext,id:string,patch:Partial<TaskRecord>,options:MutationOptions={}){const current=this.get(id);if(!current)throw new Error(`Task not found: ${id}`);const updated=deepPatch(current,patch);validateTask(updated);if(!options.dryRun){const raw=this.p.tasks.get(id)!;const{id:_,...data}=taskData(updated);this.p.change(context,u=>u.tasks.update(id,raw.revision,data))}return updated}
  complete(context:ChangeContext,id:string,date:string,options:MutationOptions={}){return this.update(context,id,{status:"completed",completedAt:date,updatedAt:date},options)}
}

export class ArtifactDomainService {
  constructor(private p:Persistence,private artifacts:ArtifactPort){}
  verify(){return this.artifacts.verify({people:this.p.people.list({includeDeleted:true}).map(p=>({id:p.id,hasLocalProfile:p.hasLocalProfile})),jobs:this.p.jobs.list({includeDeleted:true}).map(j=>({id:j.id,hasJobDescription:j.hasJobDescription,hasInterviewPrep:j.hasInterviewPrep}))})}
  async sync(context:ChangeContext){
    for(const person of this.p.people.list({includeDeleted:true})){const present=await this.artifacts.personProfileExists(person.id);if(present!==person.hasLocalProfile)this.updatePerson(context,person,present)}
    for(const job of this.p.jobs.list({includeDeleted:true})){const hasJobDescription=await this.artifacts.jobDescriptionExists(job.id),hasInterviewPrep=await this.artifacts.interviewPrepExists(job.id);if(hasJobDescription!==job.hasJobDescription||hasInterviewPrep!==job.hasInterviewPrep)this.updateJob(context,job,hasJobDescription,hasInterviewPrep)}
    return{people:this.p.people.list({includeDeleted:true}).filter(p=>p.hasLocalProfile).length,jobs:this.p.jobs.list({includeDeleted:true}).filter(j=>j.hasJobDescription||j.hasInterviewPrep).length}
  }
  private updatePerson(context:ChangeContext,record:EntityRecord<PersonData>,present:boolean){this.p.change({...context,summary:`Sync person artifact ${record.id}`},u=>{if(!record.isDeleted)return u.people.update(record.id,record.revision,{hasLocalProfile:present});const restored=u.people.restore(record.id,record.revision,{hasLocalProfile:present});return u.people.delete(record.id,restored.revision)})}
  private updateJob(context:ChangeContext,record:EntityRecord<JobData>,hasJobDescription:boolean,hasInterviewPrep:boolean){this.p.change({...context,summary:`Sync job artifact ${record.id}`},u=>{const patch={hasJobDescription,hasInterviewPrep};if(!record.isDeleted)return u.jobs.update(record.id,record.revision,patch);const restored=u.jobs.restore(record.id,record.revision,patch);return u.jobs.delete(record.id,restored.revision)})}
}

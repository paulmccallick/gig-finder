import type { ArtifactPort, Persistence } from "./ports";
import type { ChangeContext, EntityRecord, GigData, NetworkingContactData, PersonData, TaskData } from "./models";
import { fitRatings, outcomes, pipelineStages, type Gig, type GigRecord, type GigSummary } from "./gigs";
import { DomainValidationError } from "./errors";
import { compareContacts, contactIsOverdue, contactPriorities, contactStatuses, type NetworkContact, type NetworkContactRecord } from "./network";
import { compareTasks, taskIsOverdue, taskPriorities, taskStatuses, taskTypes, type TaskRecord } from "./tasks";
import {
  gigUpdateSchema,
  networkingContactUpdateSchema,
  type GigUpdate,
  type NetworkingContactUpdate,
} from "./update-contracts";
import { ChangeExecutor, type MutationOptions } from "./changes";
import type { ManagedDocumentService } from "./documents";
import {
  hasMeaningfulFilters,
  matchesQuery,
  normalizedQuery,
  pacificDate,
  page,
  type GigQueryInput,
  type NetworkingContactQueryInput,
  type Page,
  type ReadResult,
  type TaskQueryInput,
} from "./queries";

export interface GigTouchInput { date:string;stage:Gig["stage"];summary:string;outcome?:Gig["outcome"];nextAction?:string|null;due?:string|null }
export interface ContactTouchInput { date:string;status:NetworkContact["status"];method:string;summary:string;nextAction?:string|null;due?:string|null }
export interface TaskCreateInput { id:string;title:string;type:TaskRecord["type"];priority?:TaskRecord["priority"];dueDate:string|null;relatedEntity:TaskRecord["relatedEntity"];notes?:string|null;date:string }

export const defaultGigStages = [
  "applied",
  "recruiter_contact",
  "screening",
  "technical_interview",
] as const satisfies readonly Gig["stage"][];
export const defaultNetworkingContactStatuses = [
  "active_relationship",
] as const satisfies readonly NetworkContact["status"][];
export const defaultTaskStatuses = [
  "open",
  "in_progress",
] as const satisfies readonly TaskRecord["status"][];

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

function validateGig(gig: Gig) {
  if (!gig.id || !gig.company || !gig.title || !gig.statusSummary) throw new DomainValidationError("Gig id, company, title, and status summary are required.");
  if (!pipelineStages.includes(gig.stage)) throw new DomainValidationError(`Gig ${gig.id} has an unknown stage: ${gig.stage}.`);
  if (!outcomes.includes(gig.outcome)) throw new DomainValidationError(`Gig ${gig.id} has an unknown outcome: ${gig.outcome}.`);
  if (!fitRatings.includes(gig.fit.rating)) throw new DomainValidationError(`Gig ${gig.id} has an invalid fit rating: ${gig.fit.rating}.`);
  if (gig.stage === "closed" && gig.outcome === "pending") {
    throw new DomainValidationError(`Gig ${gig.id} cannot be closed while its outcome is pending.`);
  }
  if (gig.stage !== "closed" && gig.outcome !== "pending") {
    throw new DomainValidationError(`Gig ${gig.id} must remain pending until its stage is closed.`);
  }
  assertDate(gig.lastActivity, `${gig.id}.lastActivity`);
  if (gig.nextAction) {
    if (!gig.nextAction.description?.trim()) {
      throw new DomainValidationError(`Gig ${gig.id} next action requires a description.`);
    }
    assertDate(gig.nextAction.due, `${gig.id}.nextAction.due`, true);
  }
  if (gig.stage === "closed" && gig.nextAction !== null) throw new DomainValidationError(`${gig.id} is closed but still has a next action.`);
  if (gig.payRange && (!gig.payRange.currency || !gig.payRange.period)) {
    throw new DomainValidationError(`Gig ${gig.id} pay range requires currency and period.`);
  }
  if (gig.payRange?.minimum !== null && gig.payRange?.maximum !== null && gig.payRange && gig.payRange.minimum! > gig.payRange.maximum!) throw new DomainValidationError(`${gig.id} has an inverted pay range.`);
}

function gigFromData(r: GigData): Gig {
  return {id:r.id,company:r.company,title:r.title,externalJobId:r.externalJobId,artifactDirectory:`artifacts/gigs/${r.id}`,stage:r.stage as Gig["stage"],outcome:r.outcome as Gig["outcome"],statusSummary:r.statusSummary,lastActivity:r.lastActivity,nextAction:r.nextActionDescription?{description:r.nextActionDescription,due:r.nextActionDue}:null,fit:{rating:r.fitRating as Gig["fit"]["rating"],summary:r.fitSummary},payRange:r.payCurrency||r.payMinimum!==null||r.payMaximum!==null||r.payPeriod||r.payNotes?{currency:(r.payCurrency??"USD") as "USD",minimum:r.payMinimum,maximum:r.payMaximum,period:(r.payPeriod??"year") as "hour"|"year",notes:r.payNotes}:null,sourceUrl:r.sourceUrl,tags:JSON.parse(r.tagsJson),hasJobDescription:r.hasJobDescription,hasInterviewPrep:r.hasInterviewPrep,location:r.location,workArrangement:r.workArrangement,postedDate:r.postedDate,businessUnitTeam:r.businessUnitTeam,recruiterSource:r.recruiterSource,bonus:r.bonus,equity:r.equity,otherCompensation:r.otherCompensation};
}
function gigToData(r: GigSummary): GigData {
  return {id:r.id,company:r.company,title:r.title,externalJobId:r.externalJobId??null,stage:r.stage,outcome:r.outcome,statusSummary:r.statusSummary,lastActivity:r.lastActivity,nextActionDescription:r.nextAction?.description??null,nextActionDue:r.nextAction?.due??null,fitRating:r.fit.rating,fitSummary:r.fit.summary??null,payCurrency:r.payRange?.currency??null,payMinimum:r.payRange?.minimum??null,payMaximum:r.payRange?.maximum??null,payPeriod:r.payRange?.period??null,payNotes:r.payRange?.notes??null,sourceUrl:r.sourceUrl??null,location:r.location??null,workArrangement:r.workArrangement??null,postedDate:r.postedDate??null,businessUnitTeam:r.businessUnitTeam??null,recruiterSource:r.recruiterSource??null,bonus:r.bonus??null,equity:r.equity??null,otherCompensation:r.otherCompensation??null,tagsJson:JSON.stringify(r.tags??[]),hasJobDescription:r.hasJobDescription??false,hasInterviewPrep:r.hasInterviewPrep??false};
}

function contactFromData(c: NetworkingContactData & {person:PersonData;createdAt:string;updatedAt:string}): NetworkContact {
  return {id:c.id,name:c.person.name,company:c.person.company,title:c.person.title,linkedInProfileUrl:c.person.linkedInProfileUrl,profileStatus:c.person.linkedInProfileUrl?"verified":"missing",connectedOn:c.person.connectedOn,relationship:{type:c.relationshipType,strength:c.relationshipStrength as NetworkContact["relationship"]["strength"],introducedBy:c.introducedBy,notes:c.relationshipNotes},priority:c.priority as NetworkContact["priority"],status:c.status as NetworkContact["status"],outreach:{lastContacted:c.lastContacted,lastContactMethod:c.lastContactMethod,lastContactSummary:c.lastContactSummary,nextAction:c.nextAction,nextActionDue:c.nextActionDue},whyInteresting:c.whyInteresting,notes:JSON.parse(c.notesJson),tags:JSON.parse(c.tagsJson),source:{files:[]},createdAt:c.createdAt.slice(0,10),updatedAt:c.updatedAt.slice(0,10)};
}
function validateContact(c: NetworkContact) {
  if (!c.id || !c.name) throw new DomainValidationError("Contact id and name are required.");
  if (!contactPriorities.includes(c.priority) || !contactStatuses.includes(c.status)) throw new DomainValidationError(`${c.id} has an invalid priority or status.`);
  for (const [value,label] of [[c.createdAt,`${c.id}.createdAt`],[c.updatedAt,`${c.id}.updatedAt`],[c.connectedOn,`${c.id}.connectedOn`],[c.outreach.lastContacted,`${c.id}.outreach.lastContacted`],[c.outreach.nextActionDue,`${c.id}.outreach.nextActionDue`]] as const) assertDate(value,label,true);
  if (c.profileStatus==="verified"&&!c.linkedInProfileUrl?.match(/^https:\/\/(www\.)?linkedin\.com\/in\//)) throw new DomainValidationError(`${c.id} is verified without a LinkedIn profile URL.`);
  if (c.outreach.nextActionDue&&!c.outreach.nextAction) throw new DomainValidationError(`${c.id} has a next-action due date without a next action.`);
}
const personData=(c:NetworkContact,personId=c.id):PersonData=>({id:personId,name:c.name,company:c.company,title:c.title,linkedInProfileUrl:c.linkedInProfileUrl,connectedOn:c.connectedOn});
const networkingData=(c:NetworkContact,personId=c.id):NetworkingContactData=>({id:c.id,personId,relationshipType:c.relationship.type,relationshipStrength:c.relationship.strength,introducedBy:c.relationship.introducedBy,relationshipNotes:c.relationship.notes,priority:c.priority,status:c.status,lastContacted:c.outreach.lastContacted,lastContactMethod:c.outreach.lastContactMethod,lastContactSummary:c.outreach.lastContactSummary,nextAction:c.outreach.nextAction,nextActionDue:c.outreach.nextActionDue,whyInteresting:c.whyInteresting,notesJson:JSON.stringify(c.notes),tagsJson:JSON.stringify(c.tags)});
const taskFromData=(t:TaskData&{createdAt:string;updatedAt:string}):TaskRecord=>({id:t.id,title:t.title,type:t.type as TaskRecord["type"],status:t.status as TaskRecord["status"],priority:t.priority as TaskRecord["priority"],dueDate:t.dueDate,relatedEntity:{type:t.relatedEntityType as TaskRecord["relatedEntity"]["type"],id:t.relatedEntityId,label:t.relatedEntityLabel},notes:t.notes,createdAt:t.createdAt.slice(0,10),updatedAt:t.updatedAt.slice(0,10),completedAt:t.completedAt});
const taskData=(t:TaskRecord):TaskData=>({id:t.id,title:t.title,type:t.type,status:t.status,priority:t.priority,dueDate:t.dueDate,relatedEntityType:t.relatedEntity.type,relatedEntityId:t.relatedEntity.id,relatedEntityLabel:t.relatedEntity.label,notes:t.notes,completedAt:t.completedAt});
function validateTask(t:TaskRecord){if(!t.id||!t.title)throw new Error("Task id and title are required.");if(!taskTypes.includes(t.type)||!taskStatuses.includes(t.status)||!taskPriorities.includes(t.priority))throw new Error(`${t.id} has an invalid type, status, or priority.`);assertDate(t.dueDate,`${t.id}.dueDate`,true)}

export class GigDomainService {
  constructor(private p:Persistence,private artifacts:ArtifactPort,private changes:ChangeExecutor,private documents:ManagedDocumentService){}
  private record(r:GigData){return{...gigFromData(r),documents:this.documents.summaries("gig",r.id)}}
  get(id:string){const r=this.p.gigs.get(id);return r?this.record(r):null}
  list(){return this.p.gigs.list().map(r=>this.record(r))}
  read(id:string):ReadResult<GigRecord>{const record=this.get(id);return record?{status:"ok",record}:{status:"not_found",id}}
  query(input:GigQueryInput):Page<GigRecord>{
    const today=pacificDate();
    const hasFilters=hasMeaningfulFilters(input as Record<string,unknown>);
    const stages=input.stages??(hasFilters?[...pipelineStages]:[...defaultGigStages]);
    const query=normalizedQuery(input.query);
    return page(this.list()
      .filter(gig=>stages.includes(gig.stage))
      .filter(gig=>input.outcomes===undefined||input.outcomes.includes(gig.outcome))
      .filter(gig=>input.fitRatings===undefined||input.fitRatings.includes(gig.fit.rating))
      .filter(gig=>!input.overdueOnly||Boolean(gig.nextAction?.due&&gig.nextAction.due<today))
      .filter(gig=>matchesQuery(query,[gig.company,gig.title,gig.statusSummary,gig.nextAction?.description]))
      .sort((a,b)=>Number(Boolean(b.nextAction?.due&&b.nextAction.due<today))-Number(Boolean(a.nextAction?.due&&a.nextAction.due<today))
        ||(a.nextAction?.due??"9999-12-31").localeCompare(b.nextAction?.due??"9999-12-31")
        ||b.lastActivity.localeCompare(a.lastActivity)||a.company.localeCompare(b.company)||a.id.localeCompare(b.id)),input)
  }
  create(context:ChangeContext,gig:GigSummary,options:MutationOptions={}){const complete=gigFromData(gigToData(gig));validateGig(complete);if(!options.dryRun)this.p.change(context,u=>u.gigs.create(gigToData(complete)));return{...complete,documents:[]}}
  update(context:ChangeContext,id:string,patch:GigUpdate,options:MutationOptions={}){const validatedPatch=gigUpdateSchema.parse(patch);const current=this.get(id);if(!current)throw new Error(`Gig not found: ${id}`);const updated=deepPatch(current,validatedPatch);validateGig(updated);const raw=this.p.gigs.get(id)!;const{id:_,...data}=gigToData(updated);return this.changes.execute(context,updated,options,u=>this.record(u.gigs.update(id,raw.revision,data)))}
  touch(context:ChangeContext,id:string,input:GigTouchInput,options:MutationOptions={}){return this.update(context,id,{lastActivity:input.date,stage:input.stage,statusSummary:input.summary,...(input.outcome!==undefined?{outcome:input.outcome}:{}),...(input.stage==="closed"?{nextAction:null}:input.nextAction!==undefined||input.due!==undefined?{nextAction:input.nextAction?{description:input.nextAction,due:input.due??null}:null}:{})},options).record}
  async description(id:string){const gig=this.get(id);if(!gig)throw new Error(`Gig not found: ${id}`);return gig.hasJobDescription?this.artifacts.jobDescription(id):null}
  async prep(id:string){const gig=this.get(id);if(!gig)throw new Error(`Gig not found: ${id}`);return gig.hasInterviewPrep?this.artifacts.interviewPrep(id):[]}
}

export class ContactDomainService {
  constructor(private p:Persistence,private changes:ChangeExecutor,private documents:ManagedDocumentService){}
  private record(c:NetworkingContactData,person:PersonData,createdAt:string,updatedAt:string){const documents=this.documents.summaries("person",person.id);return{...contactFromData({...c,person,createdAt,updatedAt}),personId:person.id,hasProfile:documents.some(document=>document.type==="profile"),documents}}
  get(id:string){const c=this.p.networking.get(id);if(!c)return null;const person=this.p.people.get(c.personId);if(!person)throw new Error(`Contact ${id} references missing person ${c.personId}`);return this.record(c,person,c.createdAt,c.updatedAt)}
  personId(id:string){return this.p.networking.get(id)?.personId??null}
  list(){return this.p.networking.list().map(c=>{const person=this.p.people.get(c.personId);if(!person)throw new Error(`Contact ${c.id} references missing person ${c.personId}`);return this.record(c,person,c.createdAt,c.updatedAt)})}
  read(id:string):ReadResult<NetworkContactRecord>{
    const contact=this.p.networking.get(id);
    if(!contact)return{status:"not_found",id};
    const person=this.p.people.get(contact.personId);
    return person?{status:"ok",record:this.record(contact,person,contact.createdAt,contact.updatedAt)}:{status:"consistency_error",id,message:`Contact ${id} references missing person ${contact.personId}.`};
  }
  query(input:NetworkingContactQueryInput):Page<NetworkContactRecord>{
    const today=pacificDate();
    const hasFilters=hasMeaningfulFilters(input as Record<string,unknown>);
    const statuses=input.statuses??(hasFilters?[...contactStatuses]:[...defaultNetworkingContactStatuses]);
    const query=normalizedQuery(input.query);
    return page(this.list()
      .filter(contact=>statuses.includes(contact.status))
      .filter(contact=>input.priorities===undefined||input.priorities.includes(contact.priority))
      .filter(contact=>input.relationshipStrengths===undefined||input.relationshipStrengths.includes(contact.relationship.strength))
      .filter(contact=>!input.overdueOnly||contactIsOverdue(contact,today))
      .filter(contact=>matchesQuery(query,[contact.name,contact.company,contact.title,contact.whyInteresting]))
      .sort((a,b)=>compareContacts(a,b,today)||a.id.localeCompare(b.id)),input)
  }
  create(context:ChangeContext,c:NetworkContact,options:MutationOptions={}){validateContact(c);if(!options.dryRun)this.p.change(context,u=>{u.people.create(personData(c));u.networking.create(networkingData(c))});return options.dryRun?{...c,personId:c.id,hasProfile:false,documents:[]}:this.get(c.id)!}
  update(context:ChangeContext,id:string,patch:NetworkingContactUpdate,options:MutationOptions={}){const validatedPatch=networkingContactUpdateSchema.parse(patch);const current=this.get(id);if(!current)throw new Error(`Contact not found: ${id}`);const candidate=deepPatch(current,validatedPatch);const updated={...candidate,profileStatus:candidate.linkedInProfileUrl?"verified" as const:"missing" as const};validateContact(updated);const raw=this.p.networking.get(id)!,person=this.p.people.get(raw.personId)!;const pd=personData(updated,person.id),nd=networkingData(updated,person.id);const{id:_,...pp}=pd,{id:__,...np}=nd;return this.changes.execute(context,updated,options,u=>{const persistedPerson=u.people.update(person.id,person.revision,pp);const persistedNetworking=u.networking.update(id,raw.revision,np);return this.record(persistedNetworking,persistedPerson,persistedNetworking.createdAt,persistedNetworking.updatedAt)})}
  touch(context:ChangeContext,id:string,input:ContactTouchInput,options:MutationOptions={}){return this.update(context,id,{status:input.status,outreach:{lastContacted:input.date,lastContactMethod:input.method,lastContactSummary:input.summary,nextAction:input.nextAction??null,nextActionDue:input.due??null}},options).record}
}

export class TaskDomainService {
  constructor(private p:Persistence){}
  get(id:string){const r=this.p.tasks.get(id);return r?taskFromData(r):null}
  list(){return this.p.tasks.list().map(taskFromData)}
  read(id:string):ReadResult<TaskRecord>{const record=this.get(id);return record?{status:"ok",record}:{status:"not_found",id}}
  query(input:TaskQueryInput):Page<TaskRecord>{
    const today=pacificDate();
    const hasFilters=hasMeaningfulFilters(input as Record<string,unknown>);
    const statuses=input.statuses??(hasFilters?[...taskStatuses]:[...defaultTaskStatuses]);
    const query=normalizedQuery(input.query);
    return page(this.list()
      .filter(task=>statuses.includes(task.status))
      .filter(task=>input.priorities===undefined||input.priorities.includes(task.priority))
      .filter(task=>input.types===undefined||input.types.includes(task.type))
      .filter(task=>input.relatedEntityType===undefined||task.relatedEntity.type===input.relatedEntityType)
      .filter(task=>input.relatedEntityId===undefined||task.relatedEntity.id===input.relatedEntityId)
      .filter(task=>!input.overdueOnly||taskIsOverdue(task,today))
      .filter(task=>matchesQuery(query,[task.title,task.relatedEntity.label,task.notes]))
      .sort((a,b)=>compareTasks(a,b,today)||a.id.localeCompare(b.id)),input)
  }
  create(context:ChangeContext,t:TaskRecord,options:MutationOptions={}){validateTask(t);if(!options.dryRun)this.p.change(context,u=>u.tasks.create(taskData(t)));return t}
  createNew(context:ChangeContext,input:TaskCreateInput,options:MutationOptions={}){return this.create(context,{id:input.id,title:input.title,type:input.type,status:"open",priority:input.priority??"medium",dueDate:input.dueDate,relatedEntity:input.relatedEntity,notes:input.notes??null,createdAt:input.date,updatedAt:input.date,completedAt:null},options)}
  update(context:ChangeContext,id:string,patch:Partial<TaskRecord>,options:MutationOptions={}){const current=this.get(id);if(!current)throw new Error(`Task not found: ${id}`);const updated=deepPatch(current,patch);validateTask(updated);if(!options.dryRun){const raw=this.p.tasks.get(id)!;const{id:_,...data}=taskData(updated);this.p.change(context,u=>u.tasks.update(id,raw.revision,data))}return updated}
  complete(context:ChangeContext,id:string,date:string,options:MutationOptions={}){return this.update(context,id,{status:"completed",completedAt:date,updatedAt:date},options)}
}

export class ArtifactDomainService {
  constructor(private p:Persistence,private artifacts:ArtifactPort){}
  verify(){return this.artifacts.verify({gigs:this.p.gigs.list({includeDeleted:true}).map(j=>({id:j.id,hasJobDescription:j.hasJobDescription,hasInterviewPrep:j.hasInterviewPrep}))})}
  async sync(context:ChangeContext){
    for(const gig of this.p.gigs.list({includeDeleted:true})){const hasJobDescription=await this.artifacts.jobDescriptionExists(gig.id),hasInterviewPrep=await this.artifacts.interviewPrepExists(gig.id);if(hasJobDescription!==gig.hasJobDescription||hasInterviewPrep!==gig.hasInterviewPrep)this.updateGig(context,gig,hasJobDescription,hasInterviewPrep)}
    return{gigs:this.p.gigs.list({includeDeleted:true}).filter(j=>j.hasJobDescription||j.hasInterviewPrep).length}
  }
  private updateGig(context:ChangeContext,record:EntityRecord<GigData>,hasJobDescription:boolean,hasInterviewPrep:boolean){this.p.change({...context,summary:`Sync gig artifact ${record.id}`},u=>{const patch={hasJobDescription,hasInterviewPrep};if(!record.isDeleted)return u.gigs.update(record.id,record.revision,patch);const restored=u.gigs.restore(record.id,record.revision,patch);return u.gigs.delete(record.id,restored.revision)})}
}

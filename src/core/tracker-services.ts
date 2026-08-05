import type { ArtifactPort, Persistence } from "./ports";
import type { ChangeContext, EntityRecord, GigData, TaskData } from "./models";
import { fitRatings, outcomes, pipelineStages, type Gig, type GigRecord, type GigSummary } from "./gigs";
import { DomainValidationError, MutationError } from "./errors";
import { compareTasks, taskIsOverdue, taskPriorities, taskStatuses, taskTypes, type TaskRecord } from "./tasks";
import {
  gigUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  type GigUpdate,
  type TaskCreate,
  type TaskRelatedEntityInput,
  type TaskUpdate,
} from "./update-contracts";
import { ChangeExecutor, type MutationOptions } from "./changes";
import type { ManagedDocumentService } from "./documents";
import type { PeopleService } from "./services";
import { gigCreateSchema, type GigCreateInput } from "./create-contracts";
import {
  hasMeaningfulFilters,
  isCalendarDate,
  matchesQuery,
  normalizedQuery,
  pacificDate,
  page,
  type GigQueryInput,
  type Page,
  type ReadResult,
  type TaskQueryInput,
} from "./queries";

export interface GigTouchInput { date:string;stage:Gig["stage"];summary:string;outcome?:Gig["outcome"];nextAction?:string|null;due?:string|null }
export type TaskCreateInput = TaskCreate & { id:string };

export const defaultGigStages = [
  "applied",
  "recruiter_contact",
  "screening",
  "technical_interview",
] as const satisfies readonly Gig["stage"][];
export const defaultTaskStatuses = [
  "open",
  "in_progress",
] as const satisfies readonly TaskRecord["status"][];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const assertDate = (value: unknown, label: string, nullable = false) => {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !datePattern.test(value) || !isCalendarDate(value)) {
    throw new DomainValidationError(`${label} must be a valid calendar date in YYYY-MM-DD format.`);
  }
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

const taskBusinessDate = (value: string, label: string) => {
  if (isCalendarDate(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new DomainValidationError(`${label} must be a valid timestamp.`);
  }
  return pacificDate(instant);
};
const taskFromData=(t:TaskData&{createdAt:string;updatedAt:string}):TaskRecord=>({id:t.id,title:t.title,type:t.type as TaskRecord["type"],status:t.status as TaskRecord["status"],priority:t.priority as TaskRecord["priority"],dueDate:t.dueDate,relatedEntity:{type:t.relatedEntityType as TaskRecord["relatedEntity"]["type"],id:t.relatedEntityId,label:t.relatedEntityLabel},notes:t.notes,createdAt:taskBusinessDate(t.createdAt,`${t.id}.createdAt`),updatedAt:taskBusinessDate(t.updatedAt,`${t.id}.updatedAt`),completedAt:t.completedAt});
const taskData=(t:TaskRecord):TaskData=>({id:t.id,title:t.title,type:t.type,status:t.status,priority:t.priority,dueDate:t.dueDate,relatedEntityType:t.relatedEntity.type,relatedEntityId:t.relatedEntity.id,relatedEntityLabel:t.relatedEntity.label,notes:t.notes,completedAt:t.completedAt});
function validateTask(t:TaskRecord){
  if(!t.id||!t.title.trim())throw new DomainValidationError("Task id and title are required.");
  if(!taskTypes.includes(t.type)||!taskStatuses.includes(t.status)||!taskPriorities.includes(t.priority))throw new DomainValidationError(`${t.id} has an invalid type, status, or priority.`);
  assertDate(t.dueDate,`${t.id}.dueDate`,true);
  assertDate(t.completedAt,`${t.id}.completedAt`,true);
  if(t.relatedEntity.type==="general"&&t.relatedEntity.id!==null)throw new DomainValidationError("A general task must use a null related-entity ID.");
  if(t.relatedEntity.type!=="general"&&t.relatedEntity.id===null)throw new DomainValidationError(`A ${t.relatedEntity.type} task requires an exact related-entity ID.`);
  if(!t.relatedEntity.label.trim())throw new DomainValidationError(`Task ${t.id} requires a related-entity label.`);
  if(t.status==="completed"&&t.completedAt===null)throw new DomainValidationError(`Completed task ${t.id} requires a completion date.`);
  if(t.status!=="completed"&&t.completedAt!==null)throw new DomainValidationError(`Non-completed task ${t.id} cannot have a completion date.`);
}

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
  createNew(context:ChangeContext,id:string,input:GigCreateInput,options:MutationOptions={}){
    if(context.changeId&&this.p.hasChange(context.changeId)){
      const existing=this.get(id);if(!existing)throw new MutationError("revision_conflict",`Change ${context.changeId} does not match Gig ${id}.`);
      return{record:existing,changeId:context.changeId};
    }
    const parsed=gigCreateSchema.parse(input);
    const duplicate=this.p.gigs.list().find(record=>(parsed.externalJobId!==null&&record.externalJobId===parsed.externalJobId)||(record.company.trim().toLocaleLowerCase()===parsed.company.toLocaleLowerCase()&&record.title.trim().toLocaleLowerCase()===parsed.title.toLocaleLowerCase()));
    if(duplicate)throw new MutationError("duplicate",`Gig already exists: ${duplicate.id}`);
    const candidate:GigSummary={id,...parsed,artifactDirectory:`artifacts/gigs/${id}`,hasJobDescription:false,hasInterviewPrep:false};
    const complete=gigFromData(gigToData(candidate));validateGig(complete);
    return this.changes.execute(context,{...complete,documents:[]},options,u=>this.record(u.gigs.create(gigToData(complete))));
  }
  update(context:ChangeContext,id:string,patch:GigUpdate,options:MutationOptions={}){const validatedPatch=gigUpdateSchema.parse(patch);const current=this.get(id);if(!current)throw new Error(`Gig not found: ${id}`);const updated=deepPatch(current,validatedPatch);validateGig(updated);const raw=this.p.gigs.get(id)!;const{id:_,...data}=gigToData(updated);return this.changes.execute(context,updated,options,u=>this.record(u.gigs.update(id,raw.revision,data)))}
  touch(context:ChangeContext,id:string,input:GigTouchInput,options:MutationOptions={}){return this.update(context,id,{lastActivity:input.date,stage:input.stage,statusSummary:input.summary,...(input.outcome!==undefined?{outcome:input.outcome}:{}),...(input.stage==="closed"?{nextAction:null}:input.nextAction!==undefined||input.due!==undefined?{nextAction:input.nextAction?{description:input.nextAction,due:input.due??null}:null}:{})},options).record}
  async description(id:string){const gig=this.get(id);if(!gig)throw new Error(`Gig not found: ${id}`);return gig.hasJobDescription?this.artifacts.jobDescription(id):null}
  async prep(id:string){const gig=this.get(id);if(!gig)throw new Error(`Gig not found: ${id}`);return gig.hasInterviewPrep?this.artifacts.interviewPrep(id):[]}
}

export class TaskDomainService {
  constructor(private p:Persistence,private gigs:Pick<GigDomainService,"get">,private people:Pick<PeopleService,"get">,private changes:ChangeExecutor){}
  private mutation(context:ChangeContext){
    const occurredAt=context.occurredAt??new Date().toISOString(),instant=new Date(occurredAt);
    if(Number.isNaN(instant.getTime()))throw new DomainValidationError("Task change occurredAt must be a valid timestamp.");
    return{context:{...context,occurredAt},date:pacificDate(instant)};
  }
  private relatedEntity(input:TaskRelatedEntityInput):TaskRecord["relatedEntity"]{
    if(input.type==="general")return{type:"general",id:null,label:"General"};
    if(input.id===null)throw new DomainValidationError(`A ${input.type} task requires an exact related-entity ID.`);
    if(input.type==="gig"){
      const gig=this.gigs.get(input.id);
      if(!gig)throw new Error(`Gig not found: ${input.id}`);
      return{type:"gig",id:input.id,label:`${gig.company} ${gig.title}`};
    }
    const person=this.people.get(input.id);
    if(!person)throw new Error(`Person not found: ${input.id}`);
    return{type:"person",id:input.id,label:person.name};
  }
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
  private create(context:ChangeContext,t:TaskRecord,options:MutationOptions={}){validateTask(t);return this.changes.execute(context,t,options,u=>taskFromData(u.tasks.create(taskData(t),{reversible:true})))}
  createNew(context:ChangeContext,input:TaskCreateInput,options:MutationOptions={}){
    const{id,...values}=input,parsed=taskCreateSchema.parse(values),mutation=this.mutation(context);
    return this.create(mutation.context,{id,title:parsed.title,type:parsed.type,status:"open",priority:parsed.priority??"medium",dueDate:parsed.dueDate,relatedEntity:this.relatedEntity(parsed.relatedEntity),notes:parsed.notes,createdAt:mutation.date,updatedAt:mutation.date,completedAt:null},options)
  }
  update(context:ChangeContext,id:string,patch:TaskUpdate,options:MutationOptions={}){
    const parsed=taskUpdateSchema.parse(patch),current=this.get(id);
    if(!current)throw new Error(`Task not found: ${id}`);
    const{relatedEntity,...fields}=parsed;
    const mutation=this.mutation(context),status=parsed.status??current.status;
    const completedAt=parsed.status===undefined
      ?current.completedAt
      :status==="completed"
        ?current.status==="completed"&&current.completedAt!==null?current.completedAt:mutation.date
        :null;
    const updated:TaskRecord={...current,...fields,...(relatedEntity?{relatedEntity:this.relatedEntity(relatedEntity)}:{}),status,completedAt,updatedAt:mutation.date};
    validateTask(updated);
    const raw=this.p.tasks.get(id)!;
    const{id:_,...data}=taskData(updated);
    return this.changes.execute(mutation.context,updated,options,u=>taskFromData(u.tasks.update(id,raw.revision,data)));
  }
  complete(context:ChangeContext,id:string,date:string,options:MutationOptions={}){return this.update({...context,occurredAt:context.occurredAt??`${date}T12:00:00-07:00`},id,{status:"completed"},options).record}
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

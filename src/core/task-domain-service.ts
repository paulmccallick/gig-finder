import type { Persistence } from "./ports";
import type { ChangeContext, TaskData } from "./models";
import { DomainValidationError } from "./errors";
import { compareTasks, taskInputSchema, taskIsOverdue, taskPriorities, taskStatuses, taskTypes, type TaskInput, type TaskRecord, type TaskRelatedEntityInput } from "./tasks";
import { ChangeExecutor, type MutationOptions } from "./changes";
import type { PeopleService } from "./services";
import type { GigDomainService } from "./gig-domain-service";
import {
  hasMeaningfulFilters,
  isCalendarDate,
  matchesQuery,
  normalizedQuery,
  pacificDate,
  page,
  type Page,
  type ReadResult,
  type TaskQueryInput,
} from "./queries";

export type TaskCreateInput = TaskInput & { id:string };

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
    const{id,...values}=input,parsed=taskInputSchema.parse(values),mutation=this.mutation(context);
    if(!parsed.title||!parsed.type||!parsed.relatedEntity)throw new DomainValidationError("Task title, type, and related entity are required.");
    return this.create(mutation.context,{id,title:parsed.title,type:parsed.type,status:"open",priority:parsed.priority??"medium",dueDate:parsed.dueDate??null,relatedEntity:this.relatedEntity(parsed.relatedEntity),notes:parsed.notes??null,createdAt:mutation.date,updatedAt:mutation.date,completedAt:null},options)
  }
  update(context:ChangeContext,id:string,patch:TaskInput,options:MutationOptions={}){
    const parsed=taskInputSchema.parse(patch),current=this.get(id);
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

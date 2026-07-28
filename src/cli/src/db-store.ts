import type { BusinessEventInput,JobPersonData,MeetingData,PersonData } from "../../core/src/models";
import type {
  CreateManagedDocumentInput,
  UpdateManagedDocumentInput,
} from "../../core/src/documents";
import type { JobRole } from "../../core/src/jobs";
import type { NetworkContact } from "../../core/src/network";
import type { TaskPriority,TaskRecord,TaskStatus,TaskType } from "../../core/src/tasks";
import type { ContactTouchInput,JobTouchInput,TaskCreateInput } from "../../core/src/tracker-services";
import type { JobUpdate, NetworkingContactUpdate } from "../../core/src/update-contracts";
import { openLocalApplication,resolveJobSearchContext } from "../../sqlite/src";

export interface TrackerPaths{database:string;artifacts:string;actor:string}
export interface UpdateOptions{dryRun?:boolean;date?:string}
export const trackerPaths=(repoRoot:string):TrackerPaths=>{const resolved=resolveJobSearchContext(repoRoot);return{database:resolved.database,artifacts:resolved.artifacts,actor:resolved.actor}};
export function pacificDate(now=new Date()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";return`${get("year")}-${get("month")}-${get("day")}`}
const timestamp=(date?:string)=>`${date??pacificDate()}T12:00:00-07:00`;
const context=(paths:TrackerPaths,summary:string,date?:string)=>({actor:paths.actor,source:"user_request" as const,summary,occurredAt:timestamp(date)});
function withApplication<T>(paths:TrackerPaths,action:(app:ReturnType<typeof openLocalApplication>["application"])=>T):T{
  const local=openLocalApplication(paths);
  try{
    const result=action(local.application);
    if(result instanceof Promise)return result.finally(local.close) as T;
    local.close();
    return result;
  }catch(error){local.close();throw error}
}

export const getJob=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.jobs.get(id));
export const listJobs=(paths:TrackerPaths)=>withApplication(paths,app=>app.jobs.list());
export const createJob=(paths:TrackerPaths,record:JobRole,options:UpdateOptions={})=>withApplication(paths,app=>app.jobs.create(context(paths,"CLI job create",record.lastActivity),record,options));
export const updateJob=(paths:TrackerPaths,id:string,patch:JobUpdate,options:UpdateOptions={})=>withApplication(paths,app=>app.jobs.update(context(paths,`CLI job update ${id}`,options.date),id,patch,options).record);
export const touchJob=(paths:TrackerPaths,id:string,input:JobTouchInput,options:UpdateOptions={})=>withApplication(paths,app=>app.jobs.touch(context(paths,`CLI job touch ${id}`,input.date),id,input,options));

export const getContact=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.networking.get(id));
export const listContacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.networking.list());
export const createContact=(paths:TrackerPaths,record:NetworkContact,options:UpdateOptions={})=>withApplication(paths,app=>app.networking.create(context(paths,"CLI networking create",record.createdAt),record,options));
export const updateContact=(paths:TrackerPaths,id:string,patch:NetworkingContactUpdate,options:UpdateOptions={})=>withApplication(paths,app=>app.networking.update(context(paths,`CLI networking update ${id}`,options.date),id,patch,options).record);
export const touchContact=(paths:TrackerPaths,id:string,input:ContactTouchInput,options:UpdateOptions={})=>withApplication(paths,app=>app.networking.touch(context(paths,`CLI networking touch ${id}`,input.date),id,input,options));

export const getTask=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.tasks.get(id));
export const listTasks=(paths:TrackerPaths)=>withApplication(paths,app=>app.tasks.list());
export const createTask=(paths:TrackerPaths,record:TaskRecord,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.create(context(paths,"CLI task create",record.createdAt),record,options));
export const createTaskFromInput=(paths:TrackerPaths,input:TaskCreateInput,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.createNew(context(paths,"CLI task create",input.date),input,options));
export const updateTask=(paths:TrackerPaths,id:string,patch:Partial<TaskRecord>,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.update(context(paths,`CLI task update ${id}`,options.date),id,{...patch,updatedAt:options.date??pacificDate()},options));
export const completeTask=(paths:TrackerPaths,id:string,date:string,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.complete(context(paths,`CLI task complete ${id}`,date),id,date,options));

export const getPerson=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.people.get(id));
export const listPeople=(paths:TrackerPaths)=>withApplication(paths,app=>app.people.list());
export function createPerson(paths:TrackerPaths,record:PersonData,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.people.create(context(paths,"CLI person create"),record));return record}
export function updatePerson(paths:TrackerPaths,id:string,patch:Partial<PersonData>,options:UpdateOptions={}){const{id:_,...data}=patch;return withApplication(paths,app=>app.people.patch(context(paths,`CLI person update ${id}`),id,data,options))}
export function createJobPerson(paths:TrackerPaths,record:JobPersonData,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.jobPeople.create(context(paths,"CLI job-person create"),record));return record}
export const getMeeting=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.meetings.get(id));
export const listMeetings=(paths:TrackerPaths)=>withApplication(paths,app=>app.meetings.list());
export function createMeeting(paths:TrackerPaths,record:MeetingData,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.meetings.create(context(paths,"CLI meeting create",record.startsAt.slice(0,10)),record));return record}
export function createEvent(paths:TrackerPaths,record:BusinessEventInput,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.events.record(context(paths,`CLI event create: ${record.type}`,record.occurredAt),record));return record}
export const listEvents=(paths:TrackerPaths,entityType?:string,entityId?:string)=>withApplication(paths,app=>app.history.events(entityType,entityId));

export const verifyArtifacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.artifacts.verify());
export const syncArtifacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.artifacts.sync(context(paths,"Sync local artifacts")));
export const listDocumentsForJob=(paths:TrackerPaths,jobId:string)=>withApplication(paths,app=>app.documents.list("job",jobId));
export const getDocument=(paths:TrackerPaths,reference:string)=>withApplication(paths,app=>app.documents.get(reference));
export const listDocumentVersions=(paths:TrackerPaths,reference:string)=>withApplication(paths,app=>app.documents.versions(reference));
export const createDocument=(paths:TrackerPaths,input:CreateManagedDocumentInput)=>withApplication(paths,app=>app.documents.create(context(paths,`CLI document create for ${input.ownerType} ${input.ownerId}`),input));
export const updateDocument=(paths:TrackerPaths,input:UpdateManagedDocumentInput)=>withApplication(paths,app=>app.documents.update(context(paths,input.changeSummary),input));
export type{TaskPriority,TaskRecord,TaskStatus,TaskType};

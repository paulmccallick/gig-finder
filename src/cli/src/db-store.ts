import type { BusinessEventInput,GigPersonData } from "../../core/src/models";
import type { Meeting } from "../../core/src/meetings";
import type {
  CreateManagedDocumentInput,
  UpdateManagedDocumentInput,
} from "../../core/src/documents";
import type { GigSummary } from "../../core/src/gigs";
import type { PersonCreateInput, PersonTouchInput } from "../../core/src/services";
import type { TaskPriority,TaskRecord,TaskStatus,TaskType } from "../../core/src/tasks";
import type { GigTouchInput,TaskCreateInput } from "../../core/src/tracker-services";
import type { GigUpdate, PersonUpdate, TaskUpdate } from "../../core/src/update-contracts";
import type { GigFinderApplication } from "../../core/src/application";

export interface CliRuntime{application:GigFinderApplication;actor:string}
type TrackerPaths=CliRuntime;
export interface UpdateOptions{dryRun?:boolean;date?:string}
export function pacificDate(now=new Date()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";return`${get("year")}-${get("month")}-${get("day")}`}
const timestamp=(date?:string)=>`${date??pacificDate()}T12:00:00-07:00`;
const context=(paths:TrackerPaths,summary:string,date?:string)=>({actor:paths.actor,source:"user_request" as const,summary,occurredAt:timestamp(date)});
function withApplication<T>(runtime:TrackerPaths,action:(app:GigFinderApplication)=>T):T{return action(runtime.application)}

export const getGig=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.gigs.get(id));
export const listGigs=(paths:TrackerPaths)=>withApplication(paths,app=>app.gigs.list());
export const createGig=(paths:TrackerPaths,record:GigSummary,options:UpdateOptions={})=>withApplication(paths,app=>app.gigs.create(context(paths,"CLI gig create",record.lastActivity),record,options));
export const updateGig=(paths:TrackerPaths,id:string,patch:GigUpdate,options:UpdateOptions={})=>withApplication(paths,app=>app.gigs.update(context(paths,`CLI gig update ${id}`,options.date),id,patch,options).record);
export const touchGig=(paths:TrackerPaths,id:string,input:GigTouchInput,options:UpdateOptions={})=>withApplication(paths,app=>app.gigs.touch(context(paths,`CLI gig touch ${id}`,input.date),id,input,options));

export const getTask=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.tasks.get(id));
export const listTasks=(paths:TrackerPaths)=>withApplication(paths,app=>app.tasks.list());
export const createTaskFromInput=(paths:TrackerPaths,input:TaskCreateInput,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.createNew(context(paths,"CLI task create",options.date),input,options).record);
export const updateTask=(paths:TrackerPaths,id:string,patch:TaskUpdate,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.update(context(paths,`CLI task update ${id}`,options.date),id,patch,options).record);
export const completeTask=(paths:TrackerPaths,id:string,date:string,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.complete(context(paths,`CLI task complete ${id}`,date),id,date,options));

export const getPerson=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.people.get(id));
export const listPeople=(paths:TrackerPaths)=>withApplication(paths,app=>app.people.list());
export const createPerson=(paths:TrackerPaths,record:PersonCreateInput,options:UpdateOptions={})=>withApplication(paths,app=>app.people.create(context(paths,"CLI person create",options.date),record,options));
export const updatePerson=(paths:TrackerPaths,id:string,patch:PersonUpdate,options:UpdateOptions={})=>withApplication(paths,app=>app.people.update(context(paths,`CLI person update ${id}`,options.date),id,patch,options).record);
export const touchPerson=(paths:TrackerPaths,id:string,input:PersonTouchInput,options:UpdateOptions={})=>withApplication(paths,app=>app.people.touch(context(paths,`CLI person touch ${id}`,input.date),id,input,options));
export function createGigPerson(paths:TrackerPaths,record:GigPersonData,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.gigPeople.create(context(paths,"CLI gig-person create"),record));return record}
export const getMeeting=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.meetings.get(id));
export const listMeetings=(paths:TrackerPaths)=>withApplication(paths,app=>app.meetings.list());
export function createMeeting(paths:TrackerPaths,record:Meeting,options:UpdateOptions={}){return options.dryRun?record:withApplication(paths,app=>app.meetings.create(context(paths,"CLI meeting create",record.startsAt.slice(0,10)),record).record)}
export function createEvent(paths:TrackerPaths,record:BusinessEventInput,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.events.record(context(paths,`CLI event create: ${record.type}`,record.occurredAt),record));return record}
export const listEvents=(paths:TrackerPaths,entityType?:string,entityId?:string)=>withApplication(paths,app=>app.history.events(entityType,entityId));

export const verifyArtifacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.artifacts.verify());
export const syncArtifacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.artifacts.sync(context(paths,"Sync local artifacts")));
export const listDocuments=(paths:TrackerPaths,entityType:"gig"|"person"|"profile",entityId:string)=>withApplication(paths,app=>app.documents.list(entityType,entityId));
export const getDocument=(paths:TrackerPaths,documentId:string)=>withApplication(paths,app=>app.documents.get(documentId));
export const listDocumentVersions=(paths:TrackerPaths,documentId:string)=>withApplication(paths,app=>app.documents.versions(documentId));
export const createDocument=(paths:TrackerPaths,input:CreateManagedDocumentInput)=>withApplication(paths,app=>app.documents.create(context(paths,`CLI document create ${input.documentType}`),input));
export const updateDocument=(paths:TrackerPaths,input:UpdateManagedDocumentInput)=>withApplication(paths,app=>app.documents.update(context(paths,input.changeSummary),input));
export type{TaskPriority,TaskRecord,TaskStatus,TaskType};

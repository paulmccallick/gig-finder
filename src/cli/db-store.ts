import type { BusinessEventInput,GigPersonData } from "../core/models";
import type { Meeting } from "../core/meetings";
import type {
  CreateManagedDocumentInput,
  UpdateManagedDocumentInput,
} from "../core/documents";
import type { GigInput, GigSummary } from "../core/gigs";
import type { PersonCreateInput, PersonTouchInput } from "../core/services";
import type { TaskInput,TaskPriority,TaskRecord,TaskStatus,TaskType } from "../core/tasks";
import type { GigTouchInput,TaskCreateInput } from "../core/tracker-services";
import type { PersonInput } from "../core/people";
import type { GigFinderApplication } from "../core/application";

export interface CliRuntime{application:GigFinderApplication;actor:string}
type TrackerPaths=CliRuntime;
export interface UpdateOptions{dryRun?:boolean;date?:string}
export function pacificDate(now=new Date()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";return`${get("year")}-${get("month")}-${get("day")}`}
const timestamp=(date?:string)=>`${date??pacificDate()}T12:00:00-07:00`;
const context=(paths:TrackerPaths,summary:string,date?:string)=>({actor:paths.actor,source:"user_request" as const,summary,occurredAt:timestamp(date)});
function withApplication<T>(runtime:TrackerPaths,action:(app:GigFinderApplication)=>T):T{return action(runtime.application)}

export const getGig=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.gigs.get(id));
export const listGigs=(paths:TrackerPaths)=>withApplication(paths,app=>app.gigs.list());
export const createGig=(paths:TrackerPaths,record:GigSummary,options:UpdateOptions={})=>withApplication(paths,app=>{
  const{id,artifactDirectory:_,hasJobDescription:__,hasInterviewPrep:___,...input}=record;
  return app.gigs.createNew(context(paths,"CLI gig create",record.lastActivity),id,{
    location:input.location??null,workArrangement:input.workArrangement??null,postedDate:input.postedDate??null,
    businessUnitTeam:input.businessUnitTeam??null,recruiterSource:input.recruiterSource??null,bonus:input.bonus??null,
    equity:input.equity??null,otherCompensation:input.otherCompensation??null,...input,
  },options).record;
});
export const updateGig=(paths:TrackerPaths,id:string,patch:GigInput,options:UpdateOptions={})=>withApplication(paths,app=>app.gigs.update(context(paths,`CLI gig update ${id}`,options.date),id,patch,options).record);
export const touchGig=(paths:TrackerPaths,id:string,input:GigTouchInput,options:UpdateOptions={})=>withApplication(paths,app=>app.gigs.touch(context(paths,`CLI gig touch ${id}`,input.date),id,input,options));

export const getTask=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.tasks.get(id));
export const listTasks=(paths:TrackerPaths)=>withApplication(paths,app=>app.tasks.list());
export const createTaskFromInput=(paths:TrackerPaths,input:TaskCreateInput,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.createNew(context(paths,"CLI task create",options.date),input,options).record);
export const updateTask=(paths:TrackerPaths,id:string,patch:TaskInput,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.update(context(paths,`CLI task update ${id}`,options.date),id,patch,options).record);
export const completeTask=(paths:TrackerPaths,id:string,date:string,options:UpdateOptions={})=>withApplication(paths,app=>app.tasks.complete(context(paths,`CLI task complete ${id}`,date),id,date,options));

export const getPerson=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.people.get(id));
export const listPeople=(paths:TrackerPaths)=>withApplication(paths,app=>app.people.list());
export const createPerson=(paths:TrackerPaths,record:PersonCreateInput,options:UpdateOptions={})=>withApplication(paths,app=>app.people.createNew(context(paths,"CLI person create",options.date),record.id,{
  name:record.name,company:record.company,title:record.title,linkedInProfileUrl:record.linkedInProfileUrl,connectedOn:record.connectedOn,
  relationship:{type:record.relationshipType??"professional_contact",strength:(record.relationshipStrength as never)??"unknown",introducedBy:record.introducedBy??null,notes:record.relationshipNotes??null},priority:(record.priority as never)??"unranked",status:(record.status as never)??"not_contacted",outreach:{lastContacted:record.lastContacted??null,lastContactMethod:record.lastContactMethod??null,lastContactSummary:record.lastContactSummary??null,nextAction:record.nextAction??null,nextActionDue:record.nextActionDue??null},whyInteresting:record.whyInteresting??null,notes:JSON.parse(record.notesJson??"[]"),tags:JSON.parse(record.tagsJson??"[]"),
},options).record);
export const updatePerson=(paths:TrackerPaths,id:string,patch:PersonInput,options:UpdateOptions={})=>withApplication(paths,app=>app.people.update(context(paths,`CLI person update ${id}`,options.date),id,patch,options).record);
export const touchPerson=(paths:TrackerPaths,id:string,input:PersonTouchInput,options:UpdateOptions={})=>withApplication(paths,app=>app.people.touch(context(paths,`CLI person touch ${id}`,input.date),id,input,options));
export const createGigPerson=(paths:TrackerPaths,record:GigPersonData,options:UpdateOptions={})=>withApplication(paths,app=>app.gigPeople.createNew(context(paths,"CLI gig-person create"),record.id,{gigId:record.gigId,personId:record.personId,relationship:record.relationship as never,notes:record.notes},options).record);
export const getMeeting=(paths:TrackerPaths,id:string)=>withApplication(paths,app=>app.meetings.get(id));
export const listMeetings=(paths:TrackerPaths)=>withApplication(paths,app=>app.meetings.list());
export function createMeeting(paths:TrackerPaths,record:Meeting,options:UpdateOptions={}){return options.dryRun?record:withApplication(paths,app=>app.meetings.create(context(paths,"CLI meeting create",record.startsAt.slice(0,10)),record).record)}
export function createEvent(paths:TrackerPaths,record:BusinessEventInput,options:UpdateOptions={}){if(!options.dryRun)withApplication(paths,app=>app.events.record(context(paths,`CLI event create: ${record.type}`,record.occurredAt),record));return record}
export const listEvents=(paths:TrackerPaths,entityType?:string,entityId?:string)=>withApplication(paths,app=>app.history.events(entityType,entityId));

export const verifyArtifacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.artifacts.verify());
export const syncArtifacts=(paths:TrackerPaths)=>withApplication(paths,app=>app.artifacts.sync(context(paths,"Sync local artifacts")));
export const listDocuments=(paths:TrackerPaths,entityType:"gig"|"person"|"profile",entityId:string)=>withApplication(paths,async app=>{
  return app.documentReader.query({owner:{entityType,entityId},offset:0,limit:50});
});
export const getDocument=(paths:TrackerPaths,documentId:string)=>withApplication(paths,app=>app.documents.get(documentId));
export const listDocumentVersions=(paths:TrackerPaths,documentId:string)=>withApplication(paths,app=>{
  const discovery=app.documentReader.versionQuery({documentId,offset:0,limit:50});
  return discovery.status==="ok"?{...discovery,items:app.documents.versions(documentId)}:discovery;
});
export const createDocument=(paths:TrackerPaths,input:CreateManagedDocumentInput)=>withApplication(paths,app=>app.documents.create(context(paths,`CLI document create ${input.documentType}`),input));
export const updateDocument=(paths:TrackerPaths,input:UpdateManagedDocumentInput)=>withApplication(paths,app=>app.documents.update(context(paths,input.changeSummary),input));
export type{TaskPriority,TaskRecord,TaskStatus,TaskType};

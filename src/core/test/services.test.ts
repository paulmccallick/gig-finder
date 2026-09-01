import { describe,expect,test } from "bun:test";
import { GigFinderApplication } from "../application";
import { ChangeExecutor } from "../changes";
import { DomainValidationError,MutationError,OptimisticConcurrencyError } from "../errors";
import type { ArtifactPort,ArtifactVerification,AuditPort,DocumentWriteRepository,Persistence,ReadRepository,UnitOfWork } from "../ports";
import type { ChangeContext,EntityRecord,GigData,GigPersonData,InteractionData,InteractionParticipantData,PersonData,TaskData } from "../models";
import { documentDisplayName,type DocumentLinkEntityType,type ManagedDocumentData,type ManagedDocumentRecord,type ManagedDocumentSourceProvenance,type ManagedDocumentVersionData } from "../documents";
import { gigInputSchema,type GigSummary } from "../gigs";
import type { NormalizedPosition } from "../scout/sourcing/contracts";

const metadata={revision:1,isDeleted:false,createdAt:"2026-07-22T12:00:00-07:00",updatedAt:"2026-07-22T12:00:00-07:00"};
class Repo<T extends{id:string}> implements ReadRepository<T>{rows=new Map<string,EntityRecord<T>>();get(id:string){return this.rows.get(id)??null}list(){return[...this.rows.values()]}create(record:T){const value={...record,...metadata};this.rows.set(record.id,value);return value}update(id:string,revision:number,patch:Partial<Omit<T,"id">>){const current=this.get(id)!;const value={...current,...patch,revision:revision+1,updatedAt:"2026-07-23T12:00:00-07:00"};this.rows.set(id,value);return value}touch(id:string,revision:number){return this.update(id,revision,{})}delete(id:string){return this.rows.get(id)!}restore(id:string){return this.rows.get(id)!}}
const gigs=new Repo<GigData>(),people=new Repo<PersonData>(),gigPeople=new Repo<GigPersonData>(),tasks=new Repo<TaskData>(),interactions=new Repo<InteractionData>(),interactionParticipants=new Repo<InteractionParticipantData>();
const personData=(identity:Pick<PersonData,"id"|"name"|"company"|"title"|"linkedInProfileUrl"|"connectedOn">):PersonData=>({...identity,relationshipType:"professional_contact",relationshipStrength:"unknown",introducedBy:null,relationshipNotes:null,priority:"unranked",status:"not_contacted",whyInteresting:null,notesJson:"[]",tagsJson:"[]"});
class DocumentRepo implements DocumentWriteRepository {
  rows=new Map<string,ManagedDocumentRecord>();histories=new Map<string,ManagedDocumentVersionData[]>();
  get(id:string){return this.rows.get(id)??null}
  createdByChange(changeId:string){return[...this.rows.values()].find(document=>this.histories.get(document.id)?.[0]?.changeId===changeId)??null}
  versionByChange(changeId:string){return[...this.histories.values()].flat().find(version=>version.changeId===changeId)??null}
  list(entityType:DocumentLinkEntityType,entityId:string){return[...this.rows.values()].filter(document=>document.links.some(link=>link.entityType===entityType&&link.entityId===entityId))}
  listVersions(id:string){return this.histories.get(id)??[]}
  create(input:{document:ManagedDocumentData;content:string;contentHash:string}){const record={...input.document,displayName:documentDisplayName(input.document),currentVersion:1,content:input.content,contentHash:input.contentHash,createdAt:metadata.createdAt,updatedAt:metadata.updatedAt};this.rows.set(record.id,record);this.histories.set(record.id,[{documentId:record.id,version:1,parentVersion:null,content:record.content,contentHash:record.contentHash,changeId:"test-change",changeSummary:"change",createdAt:record.createdAt,createdBy:"test",sourceDescription:null,sourceProvenance:null}]);return record}
  addVersion(input:{documentId:string;expectedVersion:number;content:string;contentHash:string;changeSummary:string;sourceDescription?:string;sourceProvenance?:ManagedDocumentSourceProvenance}){const current=this.get(input.documentId)!;const version=input.expectedVersion+1;const record={...current,currentVersion:version,content:input.content,contentHash:input.contentHash,updatedAt:"2026-07-23T12:00:00-07:00"};this.rows.set(record.id,record);this.histories.set(record.id,[{documentId:record.id,version,parentVersion:input.expectedVersion,content:record.content,contentHash:record.contentHash,changeId:"test-change",changeSummary:input.changeSummary,createdAt:record.updatedAt,createdBy:"test",sourceDescription:input.sourceDescription??null,sourceProvenance:input.sourceProvenance??null},...(this.histories.get(record.id)??[])]);return record}
}
const documents=new DocumentRepo();
let auditedChangeCount=0;
const appliedChangeIds=new Set<string>(),creationFingerprints=new Map<string,{entityType:string;entityId:string;payloadHash:string}>();
const persistence:Persistence={gigs,people,gigPeople,tasks,interactions,interactionParticipants,documents,settings:{get:()=>null,set:()=>undefined},hasChange:changeId=>appliedChangeIds.has(changeId),creationFingerprint:changeId=>creationFingerprints.get(changeId)??null,change:(context,action)=>{auditedChangeCount++;const changeId=context.changeId??`test-${context.summary}`;let fingerprint:{entityType:string;entityId:string;payloadHash:string}|null=null;const value=action({gigs,people,gigPeople,tasks,interactions,interactionParticipants,documents,recordCreationFingerprint:(entityType,entityId,payloadHash)=>{fingerprint={entityType,entityId,payloadHash}}} as UnitOfWork);if(context.changeId)appliedChangeIds.add(changeId);if(fingerprint)creationFingerprints.set(changeId,fingerprint);return{changeId,value}},revertChange:(revertContext,targetChangeId)=>({changeId:revertContext.changeId??`revert-${targetChangeId}`,value:[{entity:"gig",id:"gig"}]})};
const artifacts:ArtifactPort={jobDescription:async()=>"description",interviewPrep:async()=>[{name:"general.md",content:"prep"}],jobDescriptionExists:async()=>true,interviewPrepExists:async()=>true,verify:async():Promise<ArtifactVerification>=>({ok:true,errors:[],unregistered:[]})};
const audit:AuditPort={query:query=>({query})};const app=new GigFinderApplication(persistence,audit,artifacts);const context:ChangeContext={actor:"test",source:"test",summary:"change"};
const postingContext=(changeId:string):ChangeContext=>({...context,changeId,occurredAt:"2026-08-31T17:30:00Z"});
const normalizedPosting=(overrides:Partial<NormalizedPosition>={}):NormalizedPosition=>({company:"Synthetic Posting Company",sourceKey:"official",externalId:"REQ-100",canonicalUrl:"https://careers.example.test/jobs/req-100",title:"Director of Synthetic Systems",location:"Seattle, WA",locations:[{label:"Seattle, WA",workArrangement:"hybrid"}],workArrangement:"hybrid",description:"# Director of Synthetic Systems",provenance:{sourceKey:"official",sourceUrl:"https://careers.example.test/jobs",description:"listing",descriptionUrl:null},...overrides});
const seedGig=(id:string,overrides:Partial<GigSummary>={}):ReturnType<typeof app.gigs.get>=>{
 app.gigs.create(context,{id,company:"Synthetic Existing Company",title:"Synthetic Existing Role",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Synthetic existing opportunity",lastActivity:"2026-08-20",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],hasJobDescription:false,hasInterviewPrep:false,availability:"unknown",availabilityUpdatedAt:null,location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null,...overrides});
 return app.gigs.get(id);
};
describe("application services",()=>{
 test("shared creation contracts create complete gigs, people, and validated relationships",()=>{
  const gig=app.gigs.createNew({...context,changeId:"create-gig"},"contract-gig",{company:"Contract Co",title:"Director",externalJobId:null,stage:"identified",outcome:"pending",statusSummary:"Identified",lastActivity:"2026-08-05",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null});
  expect(gig).toMatchObject({changeId:"create-gig",record:{id:"contract-gig",documents:[]}});
  let duplicateGigError:unknown;
  try{app.gigs.createNew(context,"contract-gig-duplicate",{company:"Contract Co",title:"Director",externalJobId:null,stage:"identified",outcome:"pending",statusSummary:"Identified",lastActivity:"2026-08-05",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null})}catch(error){duplicateGigError=error}
  expect(duplicateGigError).toBeInstanceOf(MutationError);
  expect((duplicateGigError as MutationError).code).toBe("duplicate");
  const person=app.people.createNew({...context,changeId:"create-person"},"contract-person",{name:"Casey Example",company:"Contract Co",title:"Recruiter",linkedInProfileUrl:null,connectedOn:null});
  expect(person).toMatchObject({changeId:"create-person",record:{id:"contract-person",priority:"unranked",status:"not_contacted"}});
  const relationship=app.gigPeople.createNew({...context,changeId:"create-relationship"},"contract-relationship",{gigId:"contract-gig",personId:"contract-person",relationship:"recruiter",notes:null});
  expect(relationship).toMatchObject({changeId:"create-relationship",record:{relationship:"recruiter"}});
  expect(()=>app.gigPeople.createNew(context,"duplicate-relationship",{gigId:"contract-gig",personId:"contract-person",relationship:"recruiter",notes:null})).toThrow("Relationship already exists");
  expect(()=>app.gigPeople.createNew(context,"missing-relationship",{gigId:"missing",personId:"contract-person",relationship:"recruiter",notes:null})).toThrow("Gig not found");
 });
 test("gig service reads, writes, and loads artifacts",async()=>{app.gigs.create(context,{id:"gig",company:"Company",title:"VP",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],hasJobDescription:true,hasInterviewPrep:true});expect(app.gigs.get("gig")?.company).toBe("Company");expect(await app.gigs.description("gig")).toBe("description");expect(await app.gigs.prep("gig")).toHaveLength(1)});
 test("Gig availability changes through an audited mutation and ignores an unchanged value",()=>{
  app.gigs.create(context,{id:"gig-1",company:"Availability Company",title:"Director",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-08-20",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[]});
  const changed=app.gigs.setAvailability({actor:"Synthetic Scout",source:"automation",summary:"Observed official position availability",changeId:"scout-availability:run-1:gig-1",occurredAt:"2026-08-27T12:00:00Z"},"gig-1","available");
  expect(changed).toMatchObject({changeId:"scout-availability:run-1:gig-1",record:{availability:"available",availabilityUpdatedAt:"2026-08-27T12:00:00Z",revision:2}});
  expect(app.gigs.setAvailability({actor:"Synthetic Scout",source:"automation",summary:"Observed official position availability",changeId:"scout-availability:run-1:gig-1-repeat",occurredAt:"2026-08-27T12:00:00Z"},"gig-1","available")).toMatchObject({changeId:null,record:{revision:2}});
 });
 test("Gig availability rejects an invalid occurredAt before changing its record or audit",()=>{
  app.gigs.create(context,{id:"gig-invalid-occurred-at",company:"Availability Company",title:"Director",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-08-20",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[]});
  const before=gigs.get("gig-invalid-occurred-at");
  const auditedBefore=auditedChangeCount;

  expect(()=>app.gigs.setAvailability({...context,changeId:"invalid-occurred-at",occurredAt:"not-a-datetime"},"gig-invalid-occurred-at","available")).toThrow();

  expect(gigs.get("gig-invalid-occurred-at")).toEqual(before);
  expect(auditedChangeCount).toBe(auditedBefore);
 });
 test("ordinary Gig input rejects domain-owned availability fields",()=>{
  expect(gigInputSchema.safeParse({availability:"available"}).success).toBe(false);
  expect(gigInputSchema.safeParse({availabilityUpdatedAt:"2026-08-27T12:00:00Z"}).success).toBe(false);
 });
 test("accepting a posting without candidates immediately creates a deterministic Gig",()=>{
  const posting=normalizedPosting({company:"Synthetic Immediate Company",externalId:" IMMEDIATE-101 ",canonicalUrl:"https://careers.example.test/jobs/immediate-101",title:"Principal Synthetic Architect",location:"Portland, OR",workArrangement:"remote"});
  const preflight=app.gigs.resolvePosting(posting);

  expect(preflight).toEqual({fingerprint:expect.stringMatching(/^[0-9a-f]{64}$/),candidates:[]});
  expect(app.gigs.get("gig_d920af9453082ce0f517dfa07a0e565b")).toBeNull();

  const result=app.gigs.acceptPosting(postingContext("posting-create-no-candidate"),posting);

  expect(result).toMatchObject({status:"created",gig:{id:"gig_d920af9453082ce0f517dfa07a0e565b",company:"Synthetic Immediate Company",title:"Principal Synthetic Architect",externalJobId:"IMMEDIATE-101",sourceUrl:"https://careers.example.test/jobs/immediate-101",location:"Portland, OR",workArrangement:"remote",stage:"identified",outcome:"pending",statusSummary:"Promoted from Gig Scout",lastActivity:"2026-08-31",fit:{rating:"tbd",summary:null}}});
 });
 test("posting replay ignores transient raw description source variations",()=>{
  const context=postingContext("posting-transient-source-replay");
  const posting=normalizedPosting({company:"Synthetic Transient Source Company",externalId:"TRANSIENT-101",canonicalUrl:"https://careers.example.test/jobs/transient-101",title:"Director of Transient Sources",description:"# Stable normalized Markdown",descriptionSourceContent:"<h1>First transient source representation</h1>"});

  const accepted=app.gigs.acceptPosting(context,posting);
  const replayed=app.gigs.acceptPosting(context,{...posting,descriptionSourceContent:"&lt;h1&gt;Second transient source representation&lt;/h1&gt;"});

  expect(replayed).toEqual(accepted);
  expect(replayed).toMatchObject({status:"created",gig:{company:"Synthetic Transient Source Company",title:"Director of Transient Sources",revision:1}});
 });
 test("same-company title evidence requires review and permits confirmed separate creation",()=>{
  const existing=seedGig("posting-advisory-existing",{company:"Synthetic Advisory Company",title:"Director of Platform Simulations",externalJobId:"REQ-OLD",sourceUrl:"https://careers.example.test/jobs/req-old"})!;
  const posting=normalizedPosting({company:"Synthetic Advisory Company",title:"Director of Platform Simulations",externalId:"REQ-NEW",canonicalUrl:"https://careers.example.test/jobs/req-new"});

  const review=app.gigs.acceptPosting(postingContext("posting-review-advisory"),posting);

  expect(review).toEqual({status:"resolution_required",fingerprint:expect.stringMatching(/^[0-9a-f]{64}$/),candidates:[expect.objectContaining({gigId:existing.id,externalJobId:"REQ-OLD",matchReasons:["company_title"]})]});
  if(review.status!=="resolution_required")throw new Error("Expected posting resolution candidates.");
  const resolution={kind:"create_new" as const,reviewedFingerprint:review.fingerprint};
  const accepted=app.gigs.acceptPosting(postingContext("posting-create-advisory"),posting,resolution);
  expect(accepted).toMatchObject({status:"created",gig:{id:"gig_07099e1bfa865c20c26f892d24e9b75e",company:"Synthetic Advisory Company",externalJobId:"REQ-NEW"}});
  expect(app.gigs.acceptPosting(postingContext("posting-create-advisory"),posting,resolution)).toEqual(accepted);
  expect(gigs.list().filter(gig=>gig.id==="gig_07099e1bfa865c20c26f892d24e9b75e")).toEqual([expect.objectContaining({revision:1})]);
  expect(app.gigs.acceptPosting(postingContext("posting-create-advisory"),posting,{...resolution,reviewedFingerprint:"0".repeat(64)})).toMatchObject({status:"resolution_stale"});
  expect(app.gigs.get(existing.id)).toMatchObject({externalJobId:"REQ-OLD",revision:1});
 });
 test("posting resolution normalizes identity, preserves display values, and orders current candidates deterministically",()=>{
  seedGig("posting-order-title-b",{company:"Synthetic Ordering Company",title:"Director of Ordered Systems",externalJobId:"OTHER-B",sourceUrl:"https://careers.example.test/jobs/other-b"});
  seedGig("posting-order-closed",{company:"Synthetic Ordering Company",title:"Director of Ordered Systems",externalJobId:"OTHER-CLOSED",sourceUrl:"https://careers.example.test/jobs/other-closed",stage:"closed",outcome:"rejected",nextAction:null});
  seedGig("posting-order-title-a",{company:"Synthetic Ordering Company",title:"Director of Ordered Systems",externalJobId:"OTHER-A",sourceUrl:"https://careers.example.test/jobs/other-a"});
  seedGig("posting-order-url",{company:"Synthetic Ordering Company",title:"Different URL Role",externalJobId:"OTHER-URL",sourceUrl:"https://careers.example.test/jobs/ordered"});
  seedGig("posting-order-exact",{company:"  SYNTHETIC ORDERING COMPANY  ",title:"Different Requisition Role",externalJobId:"  ORDER-42  ",sourceUrl:"https://careers.example.test/jobs/different",availability:"available"});
  const posting=normalizedPosting({company:"synthetic ordering company",title:"  director of ordered systems  ",externalId:"order-42",canonicalUrl:"https://careers.example.test/jobs/ordered"});

  const resolution=app.gigs.resolvePosting(posting);

  expect(resolution.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(resolution.candidates.map(candidate=>candidate.gigId)).toEqual(["posting-order-exact","posting-order-url","posting-order-title-a","posting-order-title-b","posting-order-closed"]);
  expect(resolution.candidates).toEqual([
   expect.objectContaining({company:"  SYNTHETIC ORDERING COMPANY  ",externalJobId:"  ORDER-42  ",availability:"available",matchReasons:["company_requisition"]}),
   expect.objectContaining({matchReasons:["company_url"]}),
   expect.objectContaining({matchReasons:["company_title"]}),
   expect.objectContaining({matchReasons:["company_title"]}),
   expect.objectContaining({stage:"closed",outcome:"rejected",matchReasons:["company_title"]}),
  ]);
 });
 test("a posting without optional fields preserves them after combined title and URL advisory evidence",()=>{
  const existing=seedGig("posting-no-requisition",{company:"Synthetic Missing ID Company",title:"Head of Synthetic Reliability",externalJobId:"LEGACY-55",sourceUrl:"https://careers.example.test/jobs/head-reliability",location:"Remote",workArrangement:"remote"})!;
  const posting=normalizedPosting({company:"Synthetic Missing ID Company",title:"Head of Synthetic Reliability",externalId:null,canonicalUrl:"https://careers.example.test/jobs/head-reliability",location:null,workArrangement:null});
  const reviewed=app.gigs.resolvePosting(posting);
  const expectedRevision=reviewed.candidates[0]?.revision;

  expect(reviewed.candidates).toEqual([expect.objectContaining({gigId:existing.id,location:"Remote",matchReasons:["company_url","company_title"]})]);
  if(expectedRevision===undefined)throw new Error("Expected advisory candidate revision.");
  expect(app.gigs.acceptPosting(postingContext("posting-no-requisition-update"),posting,{kind:"use_existing",reviewedFingerprint:reviewed.fingerprint,gigId:existing.id,expectedGigRevision:expectedRevision})).toMatchObject({status:"updated",gig:{externalJobId:"LEGACY-55",location:"Remote",workArrangement:"remote"}});
 });
 test("exact requisition candidates still require review and reused IDs permit a confirmed separate Gig",()=>{
  const existing=seedGig("posting-reused-original",{company:"Synthetic Reused ID Company",title:"Original Synthetic Role",externalJobId:"REUSED-900",sourceUrl:"https://careers.example.test/jobs/reused-old"})!;
  const posting=normalizedPosting({company:" synthetic reused id company ",title:"Replacement Synthetic Role",externalId:" reused-900 ",canonicalUrl:"https://careers.example.test/jobs/reused-new"});

  const review=app.gigs.acceptPosting(postingContext("posting-review-reused"),posting);
  expect(review).toEqual({status:"resolution_required",fingerprint:expect.stringMatching(/^[0-9a-f]{64}$/),candidates:[expect.objectContaining({gigId:existing.id,matchReasons:["company_requisition"]})]});
  if(review.status!=="resolution_required")throw new Error("Expected exact requisition review.");
  const accepted=app.gigs.acceptPosting(postingContext("posting-create-reused"),posting,{kind:"create_new",reviewedFingerprint:review.fingerprint});
  expect(accepted).toMatchObject({status:"created",gig:{id:"gig_d7b40428901b95b5a3bae9dc2e2f0b27",externalJobId:"reused-900"}});
  expect(app.gigs.resolvePosting(posting).candidates.map(candidate=>candidate.gigId)).toEqual([accepted.status==="created"?accepted.gig.id:"unexpected",existing.id]);
 });
 test("posting acceptance returns stale and invalid resolution values without mutation",()=>{
  const reviewed=seedGig("posting-resolution-reviewed",{company:"Synthetic Resolution Company",title:"Director of Resolution",externalJobId:"RES-1"})!;
  seedGig("posting-resolution-unreviewed",{company:"Synthetic Other Company",title:"Unreviewed Role",externalJobId:"OTHER-1"});
  const posting=normalizedPosting({company:"Synthetic Resolution Company",title:"Director of Resolution",externalId:"RES-1",canonicalUrl:"https://careers.example.test/jobs/res-1"});
  const initial=app.gigs.resolvePosting(posting);
  const reviewedRevision=initial.candidates.find(candidate=>candidate.gigId===reviewed.id)?.revision;
  if(reviewedRevision===undefined)throw new Error("Expected reviewed candidate revision.");

  expect(app.gigs.acceptPosting(postingContext("posting-stale-fingerprint"),posting,{kind:"use_existing",reviewedFingerprint:"0".repeat(64),gigId:reviewed.id,expectedGigRevision:reviewedRevision})).toEqual({status:"resolution_stale",fingerprint:initial.fingerprint,candidates:initial.candidates});
  expect(app.gigs.acceptPosting(postingContext("posting-invalid-selection"),posting,{kind:"use_existing",reviewedFingerprint:initial.fingerprint,gigId:"posting-resolution-unreviewed",expectedGigRevision:1})).toEqual({status:"resolution_invalid"});
  app.gigs.update(postingContext("posting-revision-change"),reviewed.id,{statusSummary:"Reviewed externally"});
  const current=app.gigs.resolvePosting(posting);
  expect(app.gigs.acceptPosting(postingContext("posting-stale-revision"),posting,{kind:"use_existing",reviewedFingerprint:initial.fingerprint,gigId:reviewed.id,expectedGigRevision:reviewedRevision})).toEqual({status:"resolution_stale",fingerprint:current.fingerprint,candidates:current.candidates});
  expect(app.gigs.acceptPosting(postingContext("posting-current-fingerprint-stale-revision"),posting,{kind:"use_existing",reviewedFingerprint:current.fingerprint,gigId:reviewed.id,expectedGigRevision:reviewedRevision})).toEqual({status:"resolution_stale",fingerprint:current.fingerprint,candidates:current.candidates});
  expect(app.gigs.get(reviewed.id)).toMatchObject({revision:2,title:"Director of Resolution",statusSummary:"Reviewed externally"});
 });
 test("job-description version changes make a reviewed candidate fingerprint stale",()=>{
  const existing=seedGig("posting-document-version",{company:"Synthetic Document Version Company",title:"Director of Versioning",externalJobId:"DOC-5"})!;
  const document=app.documents.create(postingContext("posting-document-create"),{links:[{entityType:"gig",entityId:existing.id}],documentType:"job_description",title:"Versioned role",mediaType:"text/markdown",sourceDescription:null,content:"# Version one"}).document;
  const posting=normalizedPosting({company:"Synthetic Document Version Company",title:"Director of Versioning",externalId:"DOC-5",canonicalUrl:"https://careers.example.test/jobs/doc-5"});
  const reviewed=app.gigs.resolvePosting(posting);
  const expectedRevision=reviewed.candidates[0]?.revision;
  expect(reviewed.candidates[0]?.jobDescription).toEqual(expect.objectContaining({id:document.id,type:"job_description"}));
  if(expectedRevision===undefined)throw new Error("Expected document candidate revision.");

  app.documents.update(postingContext("posting-document-update"),{documentId:document.id,expectedVersion:1,content:"# Version two",changeSummary:"Refresh synthetic posting"});
  const current=app.gigs.resolvePosting(posting);

  expect(current.fingerprint).not.toBe(reviewed.fingerprint);
  expect(app.gigs.acceptPosting(postingContext("posting-document-stale"),posting,{kind:"use_existing",reviewedFingerprint:reviewed.fingerprint,gigId:existing.id,expectedGigRevision:expectedRevision})).toEqual({status:"resolution_stale",fingerprint:current.fingerprint,candidates:current.candidates});
 });
 test("confirmed existing acceptance updates only posting-owned fields and preserves related records",()=>{
  const existing=seedGig("posting-update-existing",{company:"Synthetic Preserved Company",title:"Earlier Synthetic Role",externalJobId:"UPDATE-77",stage:"screening",outcome:"pending",statusSummary:"Interview scheduled",lastActivity:"2026-08-27",nextAction:{description:"Prepare interview",due:"2026-09-03"},fit:{rating:"strong",summary:"Excellent fit"},payRange:{currency:"USD",minimum:180000,maximum:220000,period:"year",notes:"Base"},sourceUrl:"https://careers.example.test/jobs/old-update-77",tags:["priority"],availability:"unavailable",availabilityUpdatedAt:"2026-08-30T12:00:00Z",location:"Bellevue, WA",workArrangement:"on-site",postedDate:"2026-08-01",businessUnitTeam:"Core Platform",recruiterSource:"Referral",bonus:"20%",equity:"RSUs",otherCompensation:"Signing bonus"})!;
  const person=app.people.createNew(postingContext("posting-related-person"),"posting-related-person",{name:"Jordan Synthetic",company:"Synthetic Preserved Company",title:"Recruiter",linkedInProfileUrl:null,connectedOn:null}).record;
  app.gigPeople.createNew(postingContext("posting-related-relationship"),"posting-related-relationship",{gigId:existing.id,personId:person.id,relationship:"recruiter",notes:"Initial contact"});
  app.tasks.createNew({...postingContext("posting-related-task"),occurredAt:"2026-08-27T12:00:00Z"},{id:"posting-related-task",title:"Prepare examples",type:"interview_prep",priority:"high",dueDate:"2026-09-03",relatedEntity:{type:"gig",id:existing.id},notes:null});
  app.interactions.create(postingContext("posting-related-interaction"),"posting-related-interaction",{subject:"Recruiter screen",kind:"call",channel:"phone",direction:"mutual",status:"completed",startsAt:"2026-08-27T12:00:00Z",endsAt:"2026-08-27T12:30:00Z",timezone:"America/Los_Angeles",location:null,summary:"Positive conversation",notes:null,gigId:existing.id,personIds:[person.id],supersedesInteractionId:null,originChangeId:null,structuredData:{}});
  const document=app.documents.create(postingContext("posting-related-document"),{links:[{entityType:"gig",entityId:existing.id}],documentType:"job_description",title:"Earlier role",mediaType:"text/markdown",sourceDescription:null,content:"# Earlier role"}).document;
  const posting=normalizedPosting({company:" synthetic preserved company ",title:"Current Synthetic Role",externalId:" update-77 ",canonicalUrl:"https://careers.example.test/jobs/current-update-77",location:"Remote, US",workArrangement:"remote"});
  const reviewed=app.gigs.resolvePosting(posting);
  const reviewedRevision=reviewed.candidates.find(candidate=>candidate.gigId===existing.id)?.revision;
  if(reviewedRevision===undefined)throw new Error("Expected existing posting candidate revision.");

  const resolution={kind:"use_existing" as const,reviewedFingerprint:reviewed.fingerprint,gigId:existing.id,expectedGigRevision:reviewedRevision};
  const result=app.gigs.acceptPosting(postingContext("posting-update-confirmed"),posting,resolution);

  expect(result).toMatchObject({status:"updated",gig:{id:existing.id,revision:2,company:"Synthetic Preserved Company",title:"Current Synthetic Role",externalJobId:"update-77",sourceUrl:"https://careers.example.test/jobs/current-update-77",location:"Remote, US",workArrangement:"remote",stage:"screening",outcome:"pending",statusSummary:"Interview scheduled",lastActivity:"2026-08-27",nextAction:{description:"Prepare interview",due:"2026-09-03"},fit:{rating:"strong",summary:"Excellent fit"},payRange:{minimum:180000,maximum:220000},tags:["priority"],availability:"unavailable",availabilityUpdatedAt:"2026-08-30T12:00:00Z",postedDate:"2026-08-01",businessUnitTeam:"Core Platform",recruiterSource:"Referral",bonus:"20%",equity:"RSUs",otherCompensation:"Signing bonus",documents:[expect.objectContaining({id:document.id,type:"job_description"})],interactions:[expect.objectContaining({id:"posting-related-interaction"})]}});
  expect(app.gigs.acceptPosting(postingContext("posting-update-confirmed"),posting,resolution)).toEqual(result);
  expect(gigs.get(existing.id)?.revision).toBe(2);
  expect(app.tasks.get("posting-related-task")).toMatchObject({relatedEntity:{type:"gig",id:existing.id}});
  expect(app.gigPeople.query({gigIds:[existing.id]})).toMatchObject({status:"ok",items:[expect.objectContaining({gigId:existing.id,personId:person.id})]});
 });
 test("people service stores canonical people with neutral relationship defaults",()=>{app.people.create(context,{id:"person",name:"Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null});expect(app.people.get("person")).toMatchObject({name:"Person",relationship:{type:"professional_contact",strength:"unknown"},priority:"unranked",status:"not_contacted",lastContacted:null,lastContactMethod:null,lastContactSummary:null,notes:[],tags:[]});expect(people.get("person")).not.toHaveProperty("lastContacted")});
 test("people service includes relationship state",()=>{app.people.create(context,{id:"network-person",name:"Network Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null,relationshipType:"colleague",relationshipStrength:"warm",priority:"high",status:"not_contacted"});expect(app.people.get("network-person")).toMatchObject({name:"Network Person",relationship:{type:"colleague",strength:"warm"},priority:"high"})});
 test("task service creates and updates tasks",()=>{const created=app.tasks.createNew({...context,occurredAt:"2026-07-22T12:00:00-07:00"},{id:"task",title:"Task",type:"other",dueDate:null,relatedEntity:{type:"general",id:null},notes:null});expect(app.tasks.complete(context,created.record.id,"2026-07-22").status).toBe("completed")});
 test("Interaction service stores participant-backed interactions",()=>{if(!people.get("person"))people.create(personData({id:"person",name:"Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null}));app.interactions.create(context,"interaction",{subject:"Coffee",kind:"meeting",channel:"in_person",direction:"mutual",status:"confirmed",startsAt:"2026-07-22T12:00:00-07:00",endsAt:"2026-07-22T13:00:00-07:00",timezone:"America/Los_Angeles",location:null,summary:null,notes:null,gigId:null,personIds:["person"],supersedesInteractionId:null,originChangeId:null,structuredData:{}});expect(app.interactions.list().filter(interaction=>interaction.id==="interaction")).toHaveLength(1)});
 test("Interaction participant IDs remain distinct when domain IDs contain delimiters",()=>{people.create(personData({id:"b::c",name:"First Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null}));people.create(personData({id:"c",name:"Second Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null}));const base={subject:"Conversation",kind:"conversation" as const,channel:"in_person" as const,direction:"mutual" as const,status:"completed" as const,startsAt:"2026-07-22T12:00:00-07:00",endsAt:null,timezone:null,location:null,summary:null,notes:null,gigId:null,supersedesInteractionId:null,originChangeId:null,structuredData:{}};app.interactions.create(context,"a",{...base,personIds:["b::c"]});app.interactions.create(context,"a::b",{...base,personIds:["c"]});expect(interactionParticipants.list().filter(record=>record.interactionId==="a"||record.interactionId==="a::b").map(record=>record.id).sort()).toEqual(["interaction-participant:1:ab::c","interaction-participant:4:a::bc"])});
 test("Interaction invariants validate absolute instants, timezone, and references",()=>{if(!people.get("timestamp-person"))people.create(personData({id:"timestamp-person",name:"Timestamp Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null}));const base={subject:"Offset conversation",kind:"conversation" as const,channel:"video" as const,direction:"mutual" as const,status:"completed" as const,timezone:"America/Los_Angeles",location:null,summary:null,notes:null,gigId:null,personIds:["timestamp-person"],supersedesInteractionId:null,originChangeId:null,structuredData:{}};expect(()=>app.interactions.create(context,"valid-offset",{...base,startsAt:"2026-07-20T23:00:00+09:00",endsAt:"2026-07-20T08:00:00-07:00"})).not.toThrow();expect(()=>app.interactions.create(context,"invalid-offset",{...base,startsAt:"2026-07-20T08:00:00-07:00",endsAt:"2026-07-20T23:00:00+09:00"})).toThrow("End must not precede start");expect(()=>app.interactions.create(context,"invalid-timezone",{...base,startsAt:"2026-07-20T08:00:00-07:00",endsAt:null,timezone:"Mars/Olympus"})).toThrow("valid IANA timezone");expect(()=>app.interactions.create(context,"missing-person",{...base,startsAt:"2026-07-20T08:00:00-07:00",endsAt:null,personIds:["missing"]})).toThrow("references missing person")});
 test("Interaction updates use the shared contract and return the audited change",()=>{if(!people.get("interaction-person-1"))people.create(personData({id:"interaction-person-1",name:"First Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null}));if(!people.get("interaction-person-2"))people.create(personData({id:"interaction-person-2",name:"Second Person",company:null,title:null,linkedInProfileUrl:null,connectedOn:null}));app.interactions.create(context,"interaction-update",{subject:"Coffee",kind:"meeting",channel:"in_person",direction:"mutual",status:"confirmed",startsAt:"2026-07-22T12:00:00-07:00",endsAt:"2026-07-22T13:00:00-07:00",timezone:"America/Los_Angeles",location:"Seattle",summary:null,notes:null,gigId:null,personIds:["interaction-person-1"],supersedesInteractionId:null,originChangeId:null,structuredData:{}});const updated=app.interactions.update({...context,changeId:"interaction-update-change"},"interaction-update",{status:"completed",personIds:["interaction-person-1","interaction-person-2"],location:null});expect(updated).toMatchObject({changeId:"interaction-update-change",record:{status:"completed",personIds:["interaction-person-1","interaction-person-2"],location:null}});expect(app.interactions.get("interaction-update")).toMatchObject({status:"completed",personIds:["interaction-person-1","interaction-person-2"],location:null});expect(()=>app.interactions.update(context,"interaction-update",{endsAt:"2026-07-22T11:00:00-07:00"})).toThrow("End must not precede start")});
 test("gig-people service filters relationships",()=>{app.gigPeople.create(context,{id:"relation",gigId:"gig",personId:"person",relationship:"interviewer",notes:null});const result=app.gigPeople.query({gigIds:["gig"]});expect(result.status==="ok"?result.items:[]).toHaveLength(1)});
 test("history service delegates audit queries",()=>{expect(app.history.entity("gig","gig")).toBeTruthy()});
 test("managed document service creates immutable versions and deduplicates identical content",async()=>{
  if(!app.gigs.get("gig"))app.gigs.create(context,{id:"gig",company:"Company",title:"VP",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],hasJobDescription:true,hasInterviewPrep:true});
  const created=app.documents.create({...context,changeId:"document-create"},{links:[{entityType:"gig",entityId:"gig"}],documentType:"job_description",title:"Job description",mediaType:"text/plain",sourceDescription:"Provided by the user",content:"Original description"});
  expect(created).toMatchObject({changed:true,changeId:"document-create",document:{currentVersion:1,content:"Original description"}});
  const gigDetail=app.gigs.read("gig");
  expect(gigDetail.status).toBe("ok");
  expect(gigDetail.status==="ok" ? gigDetail.record.documents : []).toContainEqual(expect.objectContaining({id:created.document.id,type:"job_description"}));
  expect(await app.documentReader.get(created.document.id)).toMatchObject({status:"ok",record:{content:"Original description",mediaType:"text/plain",version:1,currentVersion:1}});
  const unchanged=app.documents.update({...context,changeId:"document-noop"},{documentId:created.document.id,expectedVersion:1,content:"Original description",changeSummary:"No content change"});
  expect(unchanged).toMatchObject({changed:false,changeId:null,document:{currentVersion:1}});
  const sourceDescription="Gig Scout official posting retrieved from official configuration 2.";
  const sourceProvenance={officialUrl:"https://careers.example.test/jobs/143",retrievedAt:"2026-08-29T01:00:00Z",sourceContentHash:"a".repeat(64),extractedContentHash:"b".repeat(64),sourceKey:"official",configurationVersion:2,extractionStrategy:"json-field-v1",converterVersion:"scout-description-v2"};
  expect(()=>app.documents.update({...context,changeId:"document-source-description-only"},{documentId:created.document.id,expectedVersion:1,content:"Corrected description",changeSummary:"Invalid partial provenance",sourceDescription})).toThrow(DomainValidationError);
  expect(()=>app.documents.update({...context,changeId:"document-source-provenance-only"},{documentId:created.document.id,expectedVersion:1,content:"Corrected description",changeSummary:"Invalid partial provenance",sourceProvenance})).toThrow(DomainValidationError);
  const updated=app.documents.update({...context,changeId:"document-update"},{documentId:created.document.id,expectedVersion:1,content:"Corrected description",changeSummary:"Correct source text",sourceDescription,sourceProvenance});
  expect(updated).toMatchObject({changed:true,changeId:"document-update",document:{currentVersion:2,content:"Corrected description"}});
  expect(app.documents.versions(created.document.id).map(version=>version.content)).toEqual(["Corrected description","Original description"]);
  expect(app.documents.versions(created.document.id)).toMatchObject([{sourceDescription,sourceProvenance},{sourceDescription:null,sourceProvenance:null}]);
 expect(await app.documentReader.get(created.document.id)).toMatchObject({status:"ok",record:{content:"Corrected description",mediaType:"text/plain",version:2,currentVersion:2}});
 expect(await app.documentReader.get(created.document.id,1)).toMatchObject({status:"ok",record:{content:"Original description",mediaType:"text/plain",version:1,currentVersion:2}});
  const discovery=await app.documentReader.query({owner:{entityType:"gig",entityId:"gig"},offset:0,limit:50});
  expect(discovery).toMatchObject({status:"ok",page:{limit:50,total:3}});
  expect(discovery.status==="ok"?discovery.items:[]).toContainEqual(expect.objectContaining({reference:created.document.id,storage:"managed"}));
  const versionPage=app.documentReader.versionQuery({documentId:created.document.id,offset:0,limit:1});
  expect(versionPage).toMatchObject({status:"ok",page:{limit:1,total:2},items:[{version:2}]});
  expect(versionPage.status==="ok"?versionPage.items[0]:null).not.toHaveProperty("content");
  expect(app.documentReader.versionQuery({documentId:"gig:gig:job_description"})).toMatchObject({status:"unsupported"});
 expect(()=>app.documents.update(context,{documentId:created.document.id,expectedVersion:1,content:"Stale description",changeSummary:"Stale update"})).toThrow(new MutationError("revision_conflict",`Document ${created.document.id} expected version 1 but is at version 2.`));
 });
 test("uploaded source documents preserve provenance and cannot be edited",()=>{
  if(!app.gigs.get("gig"))app.gigs.create(context,{id:"gig",company:"Company",title:"VP",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],hasJobDescription:true,hasInterviewPrep:true});
  const provenance={originalFilename:"role.pdf",detectedMediaType:"application/pdf" as const,sourceContentHash:"a".repeat(64),converter:"pdfjs-dist",converterVersion:"6.2.108",extractionWarnings:[],uploadedAt:"2026-07-29T12:00:00.000Z"};
  const created=app.documents.create({...context,changeId:"uploaded-document-create"},{links:[{entityType:"gig",entityId:"gig"}],documentType:"job_description",title:"Uploaded job description",mediaType:"text/markdown",sourceDescription:null,content:"Exact converted source",uploadProvenance:provenance});
  expect(created.document.uploadProvenance).toEqual(provenance);
  expect(()=>app.documents.update(context,{documentId:created.document.id,expectedVersion:1,content:"Rewritten source",changeSummary:"Rewrite"})).toThrow(new DomainValidationError("Uploaded source documents are immutable and cannot be updated."));
 });
 test("profiles link to exactly one person and appear on every related record",()=>{
  if(!app.gigs.get("gig"))app.gigs.create(context,{id:"gig",company:"Company",title:"VP",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[]});
  const person=app.people.get("network-person")??app.people.create(context,{id:"network-person",name:"Network Person",company:"Company",title:"Director",linkedInProfileUrl:null,connectedOn:null,relationshipType:"colleague",relationshipStrength:"warm",priority:"high",status:"active_relationship"});
  const created=app.documents.create(context,{links:[{entityType:"person",entityId:person.id},{entityType:"gig",entityId:"gig"}],documentType:"profile",title:null,mediaType:"text/markdown",sourceDescription:null,content:"Person profile"});
  expect(created.document.displayName).toBe("Profile");
  expect(app.gigs.get("gig")?.documents).toContainEqual({id:created.document.id,type:"profile",title:null,displayName:"Profile"});
  expect(app.people.get(person.id)).toMatchObject({hasProfile:true,documents:[{id:created.document.id,type:"profile",title:null,displayName:"Profile"}]});
  expect(()=>app.documents.create(context,{links:[{entityType:"gig",entityId:"gig"}],documentType:"profile",title:null,mediaType:"text/markdown",sourceDescription:null,content:"Missing person"})).toThrow(new DomainValidationError("A profile must link to exactly one person."));
 });
 test("shared gig service returns complete models and preserves fields on patch",()=>{const gig=app.gigs.create(context,{id:"complete-gig",company:"Company",title:"VP Engineering",externalJobId:"123",artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[],hasJobDescription:false,hasInterviewPrep:false,location:"Seattle",workArrangement:"hybrid",postedDate:"2026-07-20",businessUnitTeam:"Platform",recruiterSource:"Referral",bonus:"20%",equity:"RSUs",otherCompensation:null});expect(gig.location).toBe("Seattle");const updated=app.gigs.update(context,gig.id,{stage:"applied",statusSummary:"Applied"});expect(updated.record).toMatchObject({stage:"applied",location:"Seattle",workArrangement:"hybrid",bonus:"20%",equity:"RSUs"});expect(updated.changeId).toBe("test-change");expect(gigs.get(gig.id)).toMatchObject({location:"Seattle",workArrangement:"hybrid",bonus:"20%",equity:"RSUs"})});
 test("gig updates return the caller-supplied audited change",()=>{app.gigs.create(context,{id:"updated-gig",company:"Company",title:"Director",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[]});const result=app.gigs.update({...context,changeId:"change-1"},"updated-gig",{stage:"applied",statusSummary:"Applied"});expect(result).toMatchObject({changeId:"change-1",record:{stage:"applied",statusSummary:"Applied"}});expect(app.gigs.get("updated-gig")?.stage).toBe("applied")});
 test("dry-run updates return a candidate without an audit change",()=>{app.gigs.create(context,{id:"preview-gig",company:"Company",title:"Director",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[]});const result=app.gigs.update(context,"preview-gig",{statusSummary:"Preview"},{dryRun:true});expect(result).toMatchObject({changeId:null,record:{statusSummary:"Preview"}});expect(app.gigs.get("preview-gig")?.statusSummary).toBe("Found")});
 test("change reversal is a client-neutral application capability",()=>{expect(app.changes.revert({actor:"candidate",source:"user_request",summary:"Undo update",changeId:"revert-1"},"change-from-cli")).toEqual({changeId:"revert-1",revertedChangeId:"change-from-cli",affected:[{entity:"gig",id:"gig"}]})});
 test("change execution translates persistence concurrency failures",()=>{const conflictPersistence={...persistence,change:()=>{throw new OptimisticConcurrencyError("Gig gig expected revision 1, actual revision 2")}} satisfies Persistence;const executor=new ChangeExecutor(conflictPersistence);try{executor.execute(context,{id:"gig"},{},()=>({id:"gig"}));throw new Error("Expected conflict")}catch(error){expect(error).toBeInstanceOf(MutationError);expect((error as MutationError).code).toBe("revision_conflict");expect((error as Error).cause).toBeInstanceOf(OptimisticConcurrencyError)}});
 test("rejects contradictory gig stage and outcome states with clear domain errors",()=>{const gig={id:"invalid-gig",company:"Company",title:"VP Engineering",externalJobId:null,artifactDirectory:null,stage:"identified" as const,outcome:"pending" as const,statusSummary:"Found",lastActivity:"2026-07-22",nextAction:null,fit:{rating:"good" as const,summary:null},payRange:null,sourceUrl:null,tags:[],hasJobDescription:false,hasInterviewPrep:false};expect(()=>app.gigs.create(context,{...gig,stage:"closed"})).toThrow(new DomainValidationError("Gig invalid-gig cannot be closed while its outcome is pending."));expect(()=>app.gigs.create(context,{...gig,outcome:"rejected"})).toThrow(new DomainValidationError("Gig invalid-gig must remain pending until its stage is closed."))});
 test("person last-contact fields use declared timezones and preserve encoded dates without one",()=>{const person=app.people.create(context,{id:"shared-person",name:"Shared Person",company:"Company",title:"Director",linkedInProfileUrl:null,connectedOn:null,relationshipType:"former_colleague",relationshipStrength:"warm",priority:"high",status:"not_contacted"});app.interactions.create(context,"older-contact",{subject:"Email",kind:"message",channel:"email",direction:"outbound",status:"completed",startsAt:"2026-07-22T12:00:00-07:00",personIds:[person.id],summary:"First note"});app.interactions.create(context,"zoned-contact",{subject:"Late UTC call",kind:"call",channel:"phone",direction:"inbound",status:"completed",startsAt:"2026-07-24T00:30:00+00:00",timezone:"America/Los_Angeles",personIds:[person.id],summary:"Cross-midnight note"});expect(app.people.get(person.id)).toMatchObject({lastContacted:"2026-07-23",lastContactMethod:"phone",lastContactSummary:"Cross-midnight note"});app.interactions.create(context,"unzoned-contact",{subject:"Unzoned message",kind:"message",channel:"email",direction:"inbound",status:"completed",startsAt:"2026-07-24T23:30:00-07:00",timezone:null,personIds:[person.id],summary:"Encoded-date note"});expect(app.people.get(person.id)).toMatchObject({lastContacted:"2026-07-24",lastContactMethod:"email",lastContactSummary:"Encoded-date note"});expect(people.get(person.id)).not.toHaveProperty("lastContacted")});
 test("shared task service owns defaults, completion, and dry runs",()=>{const task=app.tasks.createNew({...context,occurredAt:"2026-07-22T12:00:00-07:00"},{id:"shared-task",title:"Follow up",type:"networking_follow_up",dueDate:"2026-07-24",relatedEntity:{type:"general",id:null},notes:null});expect(task.record).toMatchObject({status:"open",priority:"medium"});expect(app.tasks.complete(context,task.record.id,"2026-07-23")).toMatchObject({status:"completed",completedAt:"2026-07-23"});const preview=app.tasks.update(context,task.record.id,{title:"Preview only"},{dryRun:true});expect(preview.record.title).toBe("Preview only");expect(app.tasks.get(task.record.id)?.title).toBe("Follow up")});
 test("task mutations resolve relationships and own status dates",()=>{if(!app.gigs.get("task-gig"))app.gigs.create(context,{id:"task-gig",company:"Example",title:"VP Engineering",externalJobId:null,artifactDirectory:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-08-01",nextAction:null,fit:{rating:"good",summary:null},payRange:null,sourceUrl:null,tags:[]});if(!app.people.get("task-person"))app.people.create(context,{id:"task-person",name:"Taylor Example",company:"Example",title:"Recruiter",linkedInProfileUrl:null,connectedOn:null});const created=app.tasks.createNew({...context,occurredAt:"2026-08-01T09:00:00-07:00",changeId:"task-create-change"},{id:"relationship-task",title:"Follow up",type:"networking_follow_up",priority:"high",dueDate:"2026-08-04",relatedEntity:{type:"person",id:"task-person"},notes:null});expect(created).toMatchObject({changeId:"task-create-change",record:{status:"open",completedAt:null,relatedEntity:{type:"person",id:"task-person",label:"Taylor Example"}}});const completed=app.tasks.update({...context,occurredAt:"2026-08-02T09:00:00-07:00",changeId:"task-update-change"},created.record.id,{status:"completed",relatedEntity:{type:"gig",id:"task-gig"}});expect(completed).toMatchObject({changeId:"task-update-change",record:{status:"completed",completedAt:"2026-08-02",relatedEntity:{type:"gig",id:"task-gig",label:"Example VP Engineering"}}});const reopened=app.tasks.update({...context,occurredAt:"2026-08-03T09:00:00-07:00"},created.record.id,{status:"in_progress"});expect(reopened.record).toMatchObject({status:"in_progress",completedAt:null});expect(()=>app.tasks.update(context,created.record.id,{relatedEntity:{type:"person",id:"missing"}})).toThrow("Person not found: missing")});
});

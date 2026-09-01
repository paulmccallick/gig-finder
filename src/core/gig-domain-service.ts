import type { ArtifactPort, Persistence } from "./ports";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChangeContext, EntityRecord, GigData } from "./models";
import { fitRatings, gigAvailabilities, gigAvailabilityTimestampSchema, gigEntitySchema, gigInputSchema, outcomes, pipelineStages, postingResolutionSchema, type AcceptPostingResult, type Gig, type GigAvailability, type GigInput, type GigPostingCandidate, type GigPostingMatchReason, type GigRecord, type GigSummary, type PostingCandidateResolution, type PostingResolution } from "./gigs";
import { DomainValidationError, MutationError } from "./errors";
import { ChangeExecutor, creationPayloadHash, type MutationOptions, type MutationResult } from "./changes";
import type { ManagedDocumentService } from "./managed-document-service";
import type { NormalizedPosition } from "./scout/sourcing/contracts";
import { deepPatch } from "./deep-patch";
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
} from "./queries";

export interface GigTouchInput { date:string;stage:Gig["stage"];summary:string;outcome?:Gig["outcome"];nextAction?:string|null;due?:string|null }

export const defaultGigStages = [
  "applied",
  "recruiter_contact",
  "screening",
  "technical_interview",
] as const satisfies readonly Gig["stage"][];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const assertDate = (value: unknown, label: string, nullable = false) => {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !datePattern.test(value) || !isCalendarDate(value)) {
    throw new DomainValidationError(`${label} must be a valid calendar date in YYYY-MM-DD format.`);
  }
};
const postingIdentity = (value: string | null | undefined) => value?.trim().toLocaleLowerCase() || null;
const postingCanonicalUrl = (value: string | null | undefined) => value?.trim() || null;
interface GigMutationFingerprint { entityType:string;payloadHash:string }

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
  return {id:r.id,company:r.company,title:r.title,externalJobId:r.externalJobId,artifactDirectory:`artifacts/gigs/${r.id}`,stage:r.stage as Gig["stage"],outcome:r.outcome as Gig["outcome"],statusSummary:r.statusSummary,lastActivity:r.lastActivity,nextAction:r.nextActionDescription?{description:r.nextActionDescription,due:r.nextActionDue}:null,fit:{rating:r.fitRating as Gig["fit"]["rating"],summary:r.fitSummary},payRange:r.payCurrency||r.payMinimum!==null||r.payMaximum!==null||r.payPeriod||r.payNotes?{currency:(r.payCurrency??"USD") as "USD",minimum:r.payMinimum,maximum:r.payMaximum,period:(r.payPeriod??"year") as "hour"|"year",notes:r.payNotes}:null,sourceUrl:r.sourceUrl,tags:JSON.parse(r.tagsJson),hasJobDescription:r.hasJobDescription,hasInterviewPrep:r.hasInterviewPrep,availability:r.availability,availabilityUpdatedAt:r.availabilityUpdatedAt,location:r.location,workArrangement:r.workArrangement,postedDate:r.postedDate,businessUnitTeam:r.businessUnitTeam,recruiterSource:r.recruiterSource,bonus:r.bonus,equity:r.equity,otherCompensation:r.otherCompensation};
}
function gigToData(r: GigSummary): GigData {
  return {id:r.id,company:r.company,title:r.title,externalJobId:r.externalJobId??null,stage:r.stage,outcome:r.outcome,statusSummary:r.statusSummary,lastActivity:r.lastActivity,nextActionDescription:r.nextAction?.description??null,nextActionDue:r.nextAction?.due??null,fitRating:r.fit.rating,fitSummary:r.fit.summary??null,payCurrency:r.payRange?.currency??null,payMinimum:r.payRange?.minimum??null,payMaximum:r.payRange?.maximum??null,payPeriod:r.payRange?.period??null,payNotes:r.payRange?.notes??null,sourceUrl:r.sourceUrl??null,location:r.location??null,workArrangement:r.workArrangement??null,postedDate:r.postedDate??null,businessUnitTeam:r.businessUnitTeam??null,recruiterSource:r.recruiterSource??null,bonus:r.bonus??null,equity:r.equity??null,otherCompensation:r.otherCompensation??null,tagsJson:JSON.stringify(r.tags??[]),hasJobDescription:r.hasJobDescription??false,hasInterviewPrep:r.hasInterviewPrep??false,availability:r.availability??"unknown",availabilityUpdatedAt:r.availabilityUpdatedAt??null};
}

export class GigDomainService {
  constructor(private p:Persistence,private artifacts:ArtifactPort,private changes:ChangeExecutor,private documents:ManagedDocumentService){}
  private record(r:EntityRecord<GigData>):GigRecord;
  private record(r:EntityRecord<GigData>){const interactions=this.p.interactions.list().filter(item=>item.gigId===r.id).sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt)||a.id.localeCompare(b.id)).map(item=>({id:item.id,subject:item.subject,kind:item.kind as import("./interactions").InteractionKind,channel:item.channel as import("./interactions").InteractionChannel,status:item.status as import("./interactions").InteractionStatus,startsAt:item.startsAt}));return{...gigFromData(r),revision:r.revision,isDeleted:r.isDeleted,createdAt:r.createdAt,updatedAt:r.updatedAt,documents:this.documents.summaries("gig",r.id),interactions}}
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
  private prepareNew(id:string,input:GigInput){
    const parsed=gigInputSchema.parse(input);
    const entity=gigEntitySchema.safeParse({id,...parsed,availability:"unknown",availabilityUpdatedAt:null,artifactDirectory:`artifacts/gigs/${id}`,hasJobDescription:false,hasInterviewPrep:false});
    if(!entity.success)throw new DomainValidationError(entity.error.issues.map(issue=>issue.message).join("; "));
    const complete=gigFromData(gigToData(entity.data));
    validateGig(complete);
    return{parsed,complete};
  }
  private persistNew(
    context:ChangeContext,
    id:string,
    complete:Gig,
    options:MutationOptions,
    duplicate?:EntityRecord<GigData>,
    mutationFingerprint:GigMutationFingerprint={entityType:"gig",payloadHash:creationPayloadHash(gigToData(complete))},
  ){
    if(context.changeId){
      const fingerprint=this.p.creationFingerprint(context.changeId);
      if(fingerprint){
        const existing=this.get(id);
        if(fingerprint.entityType!==mutationFingerprint.entityType||fingerprint.entityId!==id||fingerprint.payloadHash!==mutationFingerprint.payloadHash||!existing)throw new MutationError("revision_conflict",`Change ${context.changeId} does not match Gig ${id} and payload.`);
        return{record:existing,changeId:context.changeId};
      }
      if(this.p.hasChange(context.changeId))throw new MutationError("revision_conflict",`Change ${context.changeId} does not match Gig ${id} and payload.`);
    }
    if(duplicate)throw new MutationError("duplicate",`Gig already exists: ${duplicate.id}`);
    return this.changes.execute(context,{...complete,documents:[]},options,u=>{
      u.recordCreationFingerprint(mutationFingerprint.entityType,id,mutationFingerprint.payloadHash);
      return this.record(u.gigs.create(gigToData(complete)));
    });
  }
  createNew(context:ChangeContext,id:string,input:GigInput,options:MutationOptions={}){
    const{parsed,complete}=this.prepareNew(id,input);
    const duplicate=this.p.gigs.list().find(record=>(parsed.externalJobId!==undefined&&parsed.externalJobId!==null&&record.externalJobId===parsed.externalJobId)||(parsed.company!==undefined&&parsed.title!==undefined&&record.company.trim().toLocaleLowerCase()===parsed.company.toLocaleLowerCase()&&record.title.trim().toLocaleLowerCase()===parsed.title.toLocaleLowerCase()));
    return this.persistNew(context,id,complete,options,duplicate);
  }
  resolvePosting(posting:NormalizedPosition):PostingCandidateResolution{
    const company=postingIdentity(posting.company),title=postingIdentity(posting.title),externalJobId=postingIdentity(posting.externalId),sourceUrl=postingCanonicalUrl(posting.canonicalUrl);
    if(!company||!title||!sourceUrl)throw new DomainValidationError("Posting company, title, and canonical URL are required.");
    try{new URL(sourceUrl)}catch(error){throw new DomainValidationError("Posting canonical URL must be valid.",{cause:error});}
    const candidates=this.p.gigs.list().flatMap((record):GigPostingCandidate[]=>{
      const gig=this.record(record);
      if(postingIdentity(gig.company)!==company)return[];
      const matchReasons:GigPostingMatchReason[]=[];
      if(externalJobId!==null&&postingIdentity(gig.externalJobId)===externalJobId)matchReasons.push("company_requisition");
      if(postingCanonicalUrl(gig.sourceUrl)===sourceUrl)matchReasons.push("company_url");
      if(postingIdentity(gig.title)===title)matchReasons.push("company_title");
      if(matchReasons.length===0)return[];
      const jobDescription=gig.documents.filter(document=>document.type==="job_description").sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
      return[{gigId:gig.id,revision:record.revision,company:gig.company,title:gig.title,externalJobId:gig.externalJobId,sourceUrl:gig.sourceUrl,location:gig.location,stage:gig.stage,outcome:gig.outcome,availability:gig.availability,lastActivity:gig.lastActivity,jobDescription,matchReasons}];
    }).sort((a,b)=>
      Number(!a.matchReasons.includes("company_requisition"))-Number(!b.matchReasons.includes("company_requisition"))
      ||Number(!a.matchReasons.includes("company_url"))-Number(!b.matchReasons.includes("company_url"))
      ||Number(!a.matchReasons.includes("company_title"))-Number(!b.matchReasons.includes("company_title"))
      ||Number(a.stage==="closed")-Number(b.stage==="closed")
      ||a.gigId.localeCompare(b.gigId));
    const fingerprint=createHash("sha256").update(JSON.stringify({posting:{company,title,externalJobId,sourceUrl},candidates:candidates.map(candidate=>({gigId:candidate.gigId,revision:candidate.revision,matchReasons:candidate.matchReasons,jobDescription:candidate.jobDescription?{id:candidate.jobDescription.id,version:this.p.documents.get(candidate.jobDescription.id)?.currentVersion??null}:null}))})).digest("hex");
    return{fingerprint,candidates};
  }
  acceptPosting(context:ChangeContext,posting:NormalizedPosition,resolution?:PostingResolution):AcceptPostingResult{
    const reviewed=resolution===undefined?null:postingResolutionSchema.parse(resolution);
    const replayed=this.replayedPosting(context,posting,reviewed);
    if(replayed)return replayed;
    const current=this.resolvePosting(posting);
    if(reviewed===null){
      if(current.candidates.length>0)return{status:"resolution_required",...current};
      return this.createPosting(context,posting,null);
    }
    if(reviewed.reviewedFingerprint!==current.fingerprint)return{status:"resolution_stale",...current};
    if(reviewed.kind==="create_new")return this.createPosting(context,posting,reviewed);
    const selected=current.candidates.find(candidate=>candidate.gigId===reviewed.gigId);
    if(!selected)return{status:"resolution_invalid"};
    if(selected.revision!==reviewed.expectedGigRevision)return{status:"resolution_stale",...current};
    const patch=this.postingOwnedPatch(posting);
    return{status:"updated",gig:this.persistUpdate(context,selected.gigId,patch,{},this.postingMutationFingerprint(posting,reviewed)).record};
  }
  private postingOwnedPatch(posting:NormalizedPosition):GigInput{
    const patch:GigInput={title:posting.title,sourceUrl:posting.canonicalUrl};
    if(postingIdentity(posting.externalId)!==null)patch.externalJobId=posting.externalId;
    if(postingIdentity(posting.location)!==null)patch.location=posting.location;
    if(postingIdentity(posting.workArrangement)!==null)patch.workArrangement=posting.workArrangement;
    return gigInputSchema.parse(patch);
  }
  private verifyReplayedPosting(gig:GigRecord,posting:NormalizedPosition,changeId:string){
    const expected=this.postingOwnedPatch(posting);
    if(
      gig.title!==expected.title
      ||gig.sourceUrl!==expected.sourceUrl
      ||(expected.externalJobId!==undefined&&gig.externalJobId!==expected.externalJobId)
      ||(expected.location!==undefined&&gig.location!==expected.location)
      ||(expected.workArrangement!==undefined&&gig.workArrangement!==expected.workArrangement)
    )throw new MutationError("revision_conflict",`Change ${changeId} no longer matches the accepted posting-owned Gig fields.`);
  }
  private postingMutationFingerprint(posting:NormalizedPosition,resolution:PostingResolution|null):GigMutationFingerprint{
    const payload={
      posting:{
        company:posting.company,
        sourceKey:posting.sourceKey,
        externalId:posting.externalId,
        canonicalUrl:posting.canonicalUrl,
        title:posting.title,
        location:posting.location,
        locations:posting.locations?.map(location=>({label:location.label,workArrangement:location.workArrangement}))??null,
        workArrangement:posting.workArrangement??null,
        description:posting.description,
        provenance:{
          sourceKey:posting.provenance.sourceKey,
          sourceUrl:posting.provenance.sourceUrl,
          description:posting.provenance.description,
          descriptionUrl:posting.provenance.descriptionUrl,
        },
      },
      resolution,
    };
    return{entityType:"gig-posting",payloadHash:creationPayloadHash(payload)};
  }
  private postingGigId(context:ChangeContext){
    if(!context.changeId?.trim())throw new DomainValidationError("Accepting a new posting requires a change ID.");
    return`gig_${createHash("sha256").update(`posting\0${context.changeId}`).digest("hex").slice(0,32)}`;
  }
  private replayedPosting(context:ChangeContext,posting:NormalizedPosition,resolution:PostingResolution|null):AcceptPostingResult|null{
    if(!context.changeId)return null;
    const targetId=resolution?.kind==="use_existing"?resolution.gigId:this.postingGigId(context);
    const expected=this.postingMutationFingerprint(posting,resolution),fingerprint=this.p.creationFingerprint(context.changeId);
    if(!fingerprint||fingerprint.entityType!==expected.entityType||fingerprint.entityId!==targetId||fingerprint.payloadHash!==expected.payloadHash)return null;
    const gig=this.get(targetId);
    if(!gig)throw new MutationError("revision_conflict",`Change ${context.changeId} matches missing Gig ${targetId}.`);
    this.verifyReplayedPosting(gig,posting,context.changeId);
    return{status:resolution?.kind==="use_existing"?"updated":"created",gig};
  }
  private createPosting(context:ChangeContext,posting:NormalizedPosition,resolution:PostingResolution|null):AcceptPostingResult{
    if(!context.changeId?.trim())throw new DomainValidationError("Accepting a new posting requires a change ID.");
    const occurredAt=context.occurredAt??new Date().toISOString(),instant=new Date(occurredAt);
    if(Number.isNaN(instant.getTime()))throw new DomainValidationError("Posting change occurredAt must be a valid timestamp.");
    const id=this.postingGigId(context);
    const{complete}=this.prepareNew(id,{company:posting.company,title:posting.title,externalJobId:postingIdentity(posting.externalId)===null?null:posting.externalId,stage:"identified",outcome:"pending",statusSummary:"Promoted from Gig Scout",lastActivity:pacificDate(instant),nextAction:null,fit:{rating:"tbd",summary:null},payRange:null,sourceUrl:posting.canonicalUrl,tags:[],location:postingIdentity(posting.location)===null?null:posting.location,workArrangement:postingIdentity(posting.workArrangement)===null?null:posting.workArrangement,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null});
    return{status:"created",gig:this.persistNew(context,id,complete,{},undefined,this.postingMutationFingerprint(posting,resolution)).record};
  }
  private persistUpdate(context:ChangeContext,id:string,patch:GigInput,options:MutationOptions,mutationFingerprint?:GigMutationFingerprint){
    const validatedPatch=gigInputSchema.parse(patch),current=this.get(id);
    if(!current)throw new Error(`Gig not found: ${id}`);
    const updated=deepPatch(current,validatedPatch);
    validateGig(updated);
    const raw=this.p.gigs.get(id)!;
    const{id:_,...data}=gigToData(updated);
    return this.changes.execute(context,updated,options,u=>{
      if(mutationFingerprint)u.recordCreationFingerprint(mutationFingerprint.entityType,id,mutationFingerprint.payloadHash);
      return this.record(u.gigs.update(id,raw.revision,data));
    });
  }
  update(context:ChangeContext,id:string,patch:GigInput,options:MutationOptions={}){return this.persistUpdate(context,id,patch,options)}
  setAvailability(context:ChangeContext,id:string,availability:Exclude<GigAvailability,"unknown">):MutationResult<GigRecord>{
    const requested=z.enum(gigAvailabilities).exclude(["unknown"]).parse(availability);
    const current=this.get(id);
    if(!current)throw new Error(`Gig not found: ${id}`);
    if(current.availability===requested)return{record:current,changeId:null};
    const occurredAt=gigAvailabilityTimestampSchema.parse(context.occurredAt??new Date().toISOString());
    const raw=this.p.gigs.get(id)!;
    const candidate={...current,availability:requested,availabilityUpdatedAt:occurredAt};
    return this.changes.execute({...context,occurredAt},candidate,{},transaction=>this.record(transaction.gigs.update(id,raw.revision,{availability:requested,availabilityUpdatedAt:occurredAt})));
  }
  touch(context:ChangeContext,id:string,input:GigTouchInput,options:MutationOptions={}){return this.update(context,id,{lastActivity:input.date,stage:input.stage,statusSummary:input.summary,...(input.outcome!==undefined?{outcome:input.outcome}:{}),...(input.stage==="closed"?{nextAction:null}:input.nextAction!==undefined||input.due!==undefined?{nextAction:input.nextAction?{description:input.nextAction,due:input.due??null}:null}:{})},options).record}
  async description(id:string){const gig=this.get(id);if(!gig)throw new Error(`Gig not found: ${id}`);return gig.hasJobDescription?this.artifacts.jobDescription(id):null}
  async prep(id:string){const gig=this.get(id);if(!gig)throw new Error(`Gig not found: ${id}`);return gig.hasInterviewPrep?this.artifacts.interviewPrep(id):[]}
}

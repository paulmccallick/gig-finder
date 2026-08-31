import { z } from "zod";
import { MutationError } from "../../errors";
import type { ManagedDocumentRecord, ManagedDocumentVersionData } from "../../documents";
import type { ManagedDocumentService } from "../../managed-document-service";
import type { ScoutPromotedDescriptionOutcome, ScoutPromotedDescriptionWork } from "./positions";

const boundedText=z.string().trim().min(1).max(2_000);
export const relevanceResultSchema=z.object({decision:z.enum(["fails_relevance","passes_relevance"]),reason:z.string().trim().min(1).max(255),confidence:z.number().min(0).max(1),evidence:z.array(boundedText).max(8),ambiguities:z.array(boundedText).max(8)}).strict();
export type RelevanceResult=z.infer<typeof relevanceResultSchema>;
export const candidateMatchResultSchema=z.object({score:z.number().int().min(1).max(10),scoreExplanation:z.string().trim().min(1).max(310)}).strict();
export type CandidateMatchResult=z.infer<typeof candidateMatchResultSchema>;

import type { DetailDescriptionPlan } from "../sourcing/detail-descriptions";
export interface ScoutDescriptionInput {positionId:string;externalId:string|null;title:string;company:string;location:string|null;officialUrl:string;existingDescriptionId:string|null;detailPlan:DetailDescriptionPlan|null}
export interface ScoutDescriptionResult {markdown:string;sourceContentHash:string;sourceUrl:string;retrievedAt:string;converterVersion:string;reusedDescriptionId?:string;extractedContentHash?:string;strategyVersion?:string;template?:{id:string;version:number}}
export interface ScoutEvaluationInput {positionId:string;title:string;company:string;location:string|null;officialUrl:string;descriptionMarkdown:string;descriptionArtifactId:string;descriptionHash:string}
export interface RelevanceRequest extends ScoutEvaluationInput {criteria:string;criteriaVersion:number;promptVersion:string}
export interface CandidateMatchRequest extends ScoutEvaluationInput {profile:unknown;profileVersion:string;profileArtifactId:string;profileHash:string;promptCacheKey:string;rubric:string;rubricVersion:number;promptVersion:string;relevanceEvaluationId:string}
export interface ModelMetrics {provider:string;model:string;modelConfiguration:string;inputTokens:number|null;outputTokens:number|null;cacheReadTokens?:number|null;cacheWriteTokens?:number|null;latencyMs:number}
export interface ModelResult<T> {value:T;metrics:ModelMetrics}
export type ScoutScreeningModelIdentity=Pick<ModelMetrics,"provider"|"model"|"modelConfiguration">;
export interface ScoutScreeningModel {screenRelevance(input:RelevanceRequest):Promise<ModelResult<RelevanceResult>>;scoreCandidateMatch(input:CandidateMatchRequest):Promise<ModelResult<CandidateMatchResult>>}
export interface ScoutPositionProcessingRepository {
 stage(processingId:string):"reconcile_gig"|"acquire_description"|"screen_relevance"|"score_candidate_match"|null;
 screeningModelIdentity(processingId:string):ScoutScreeningModelIdentity|null;
 reconcileGig(processingId:string,now:string):void;
 descriptionInput(processingId:string):ScoutDescriptionInput;
 acquireDescription(input:ScoutDescriptionInput):Promise<ScoutDescriptionResult>;
 prepareDescriptionCompletion(processingId:string,value:ScoutDescriptionResult,now:string):{descriptionId:string;promotedDocument:ScoutPromotedDescriptionWork|null};
 completeDescription(processingId:string,descriptionId:string,documentOutcome:ScoutPromotedDescriptionOutcome|null,now:string):void;
 failDescriptionProjection(processingId:string,code:string,message:string,now:string):void;
 relevanceInput(processingId:string):RelevanceRequest&{confidenceThreshold:number};
 completeRelevance(processingId:string,result:ModelResult<RelevanceResult>,irrelevant:boolean,now:string):void;
  candidateMatchInput(processingId:string):CandidateMatchRequest;
 refreshCandidateMatch(processingId:string,now:string):boolean;
 completeCandidateMatch(processingId:string,result:ModelResult<CandidateMatchResult>,now:string):void;
 failPositionProcessing(processingId:string,code:string,message:string,now:string):void;
}

export class ScoutPositionProcessor {
 constructor(private readonly repository:ScoutPositionProcessingRepository,private readonly model:ScoutScreeningModel,private readonly now=()=>new Date().toISOString(),private readonly selectModel?:(identity:ScoutScreeningModelIdentity)=>ScoutScreeningModel,private readonly documents?:Pick<ManagedDocumentService,"get"|"update"|"versionByChange">){}
 async process(processingId:string){
  const stage=this.repository.stage(processingId);if(!stage)return;
  if(stage==="reconcile_gig"){this.repository.reconcileGig(processingId,this.now());return;}
  if(stage==="acquire_description"){
   const input=this.repository.descriptionInput(processingId),result=await this.repository.acquireDescription(input),now=this.now();
   const prepared=this.repository.prepareDescriptionCompletion(processingId,result,now);
   if(!prepared.promotedDocument){this.repository.completeDescription(processingId,prepared.descriptionId,null,now);return;}
   try{
    if(!this.documents)throw new Error("Promoted Gig document service is unavailable.");
    const work=prepared.promotedDocument,current=this.documents.get(work.managedDocumentId);
    if(!current)throw new Error("Promoted Gig job description not found.");
    this.verifyPromotedDocument(current,work);
    const projectedVersion=this.documents.versionByChange(work.documentChangeId);
    if(projectedVersion){
     this.verifyPromotedVersion(projectedVersion,work);
     this.repository.completeDescription(processingId,prepared.descriptionId,"updated",now);
     return;
    }
    const outcome=this.documents.update({actor:"Gig Scout",source:"automation",summary:"Refresh promoted Gig job description",changeId:work.documentChangeId,occurredAt:now},{documentId:work.managedDocumentId,expectedVersion:current.currentVersion,content:work.markdown,changeSummary:"Refresh from current official Scout posting",sourceDescription:work.sourceDescription,sourceProvenance:work.sourceProvenance});
    this.verifyPromotedDocument(outcome.document,work,work.markdown);
    this.repository.completeDescription(processingId,prepared.descriptionId,outcome.changed?"updated":"unchanged",now);
   }catch(error){
    const code=error instanceof MutationError?error.code:"document_projection_failed";
    this.repository.failDescriptionProjection(processingId,code,error instanceof Error?error.message:"Promoted Gig job-description projection failed.",now);
    throw error;
   }
   return;
  }
  const selectedIdentity=this.repository.screeningModelIdentity(processingId),selectedModel=selectedIdentity?this.selectModel?.(selectedIdentity):this.model;
  if(!selectedModel)throw new Error("Scout position backfill screening model is unavailable.");
  if(stage==="screen_relevance"){const input=this.repository.relevanceInput(processingId);const result=await selectedModel.screenRelevance(input);const value=relevanceResultSchema.parse(result.value);const irrelevant=value.decision==="fails_relevance"&&value.confidence>=input.confidenceThreshold;this.repository.completeRelevance(processingId,{...result,value},irrelevant,this.now());return;}
  if(this.repository.refreshCandidateMatch(processingId,this.now()))return;
  const input=this.repository.candidateMatchInput(processingId);const result=await selectedModel.scoreCandidateMatch(input);this.repository.completeCandidateMatch(processingId,{...result,value:candidateMatchResultSchema.parse(result.value)},this.now());
 }
 private verifyPromotedDocument(document:ManagedDocumentRecord,work:ScoutPromotedDescriptionWork,expectedContent?:string){
  const exactGigOwnership=document.links.length===1&&document.links[0]?.entityType==="gig"&&document.links[0].entityId===work.gigId;
  const exactContent=expectedContent===undefined||document.content===expectedContent;
  if(document.id!==work.managedDocumentId||document.documentType!=="job_description"||document.mediaType!=="text/markdown"||!exactContent||!exactGigOwnership)throw new Error("Promoted Gig job description does not match its durable Scout link.");
 }
 private verifyPromotedVersion(version:ManagedDocumentVersionData,work:ScoutPromotedDescriptionWork){
  const actual=version.sourceProvenance,expected=work.sourceProvenance;
  const exactProvenance=actual?.officialUrl===expected.officialUrl&&actual.retrievedAt===expected.retrievedAt&&actual.sourceContentHash===expected.sourceContentHash&&actual.extractedContentHash===expected.extractedContentHash&&actual.sourceKey===expected.sourceKey&&actual.configurationVersion===expected.configurationVersion&&actual.extractionStrategy===expected.extractionStrategy&&actual.converterVersion===expected.converterVersion;
  if(version.documentId!==work.managedDocumentId||version.content!==work.markdown||version.sourceDescription!==work.sourceDescription||!exactProvenance)throw new Error("Promoted Gig job-description change does not match its durable Scout work.");
 }
}

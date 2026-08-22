import { z } from "zod";

const boundedText=z.string().trim().min(1).max(2_000);
export const relevanceResultSchema=z.object({decision:z.enum(["fails_relevance","passes_relevance"]),reason:z.string().trim().min(1).max(255),confidence:z.number().min(0).max(1),evidence:z.array(boundedText).max(8),ambiguities:z.array(boundedText).max(8)}).strict();
export type RelevanceResult=z.infer<typeof relevanceResultSchema>;
export const candidateMatchResultSchema=z.object({score:z.number().int().min(1).max(10),scoreExplanation:z.string().trim().min(1).max(310)}).strict();
export type CandidateMatchResult=z.infer<typeof candidateMatchResultSchema>;

import type { DetailDescriptionPlan } from "../sourcing/detail-descriptions";
export interface ScoutDescriptionInput {positionId:string;externalId:string|null;title:string;company:string;location:string|null;officialUrl:string;existingDescriptionId:string|null;detailPlan:DetailDescriptionPlan|null}
export interface ScoutEvaluationInput {positionId:string;title:string;company:string;location:string|null;officialUrl:string;descriptionMarkdown:string;descriptionArtifactId:string;descriptionHash:string}
export interface RelevanceRequest extends ScoutEvaluationInput {criteria:string;criteriaVersion:number;promptVersion:string}
export interface CandidateMatchRequest extends ScoutEvaluationInput {profile:unknown;profileVersion:string;profileArtifactId:string;profileHash:string;promptCacheKey:string;rubric:string;rubricVersion:number;promptVersion:string;relevanceEvaluationId:string}
export interface ModelMetrics {provider:string;model:string;modelConfiguration:string;inputTokens:number|null;outputTokens:number|null;cacheReadTokens?:number|null;cacheWriteTokens?:number|null;latencyMs:number}
export interface ModelResult<T> {value:T;metrics:ModelMetrics}
export interface ScoutScreeningModel {screenRelevance(input:RelevanceRequest):Promise<ModelResult<RelevanceResult>>;scoreCandidateMatch(input:CandidateMatchRequest):Promise<ModelResult<CandidateMatchResult>>}
export interface ScoutPositionProcessingRepository {
 stage(processingId:string):"reconcile_gig"|"acquire_description"|"screen_relevance"|"score_candidate_match"|null;
 reconcileGig(processingId:string,now:string):void;
 descriptionInput(processingId:string):ScoutDescriptionInput;
 acquireDescription(input:ScoutDescriptionInput):Promise<{markdown:string;sourceContentHash:string;sourceUrl:string;retrievedAt:string;converterVersion:string}>;
 completeDescription(processingId:string,value:{markdown:string;sourceContentHash:string;sourceUrl:string;retrievedAt:string;converterVersion:string},now:string):void;
 relevanceInput(processingId:string):RelevanceRequest&{confidenceThreshold:number};
 completeRelevance(processingId:string,result:ModelResult<RelevanceResult>,irrelevant:boolean,now:string):void;
  candidateMatchInput(processingId:string):CandidateMatchRequest;
 refreshCandidateMatch(processingId:string,now:string):boolean;
 completeCandidateMatch(processingId:string,result:ModelResult<CandidateMatchResult>,now:string):void;
 failPositionProcessing(processingId:string,code:string,message:string,now:string):void;
}

export class ScoutPositionProcessor {
 constructor(private readonly repository:ScoutPositionProcessingRepository,private readonly model:ScoutScreeningModel,private readonly now=()=>new Date().toISOString()){}
 async process(processingId:string){
  const stage=this.repository.stage(processingId);if(!stage)return;
  if(stage==="reconcile_gig"){this.repository.reconcileGig(processingId,this.now());return;}
  if(stage==="acquire_description"){const input=this.repository.descriptionInput(processingId);const result=await this.repository.acquireDescription(input);this.repository.completeDescription(processingId,result,this.now());return;}
  if(stage==="screen_relevance"){const input=this.repository.relevanceInput(processingId);const result=await this.model.screenRelevance(input);const value=relevanceResultSchema.parse(result.value);const irrelevant=value.decision==="fails_relevance"&&value.confidence>=input.confidenceThreshold;this.repository.completeRelevance(processingId,{...result,value},irrelevant,this.now());return;}
  if(this.repository.refreshCandidateMatch(processingId,this.now()))return;
  const input=this.repository.candidateMatchInput(processingId);const result=await this.model.scoreCandidateMatch(input);this.repository.completeCandidateMatch(processingId,{...result,value:candidateMatchResultSchema.parse(result.value)},this.now());
 }
}

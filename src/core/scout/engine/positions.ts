export const scoutPositionStates = ["processing","needs_user_review","irrelevant","rejected","deferred","promoted"] as const;
export type ScoutPositionState = typeof scoutPositionStates[number];
export type ScoutPositionProcessingStage = "reconcile_gig"|"acquire_description"|"screen_relevance"|"score_candidate_match";
export type ScoutPositionProcessingStatus = "pending"|"completed"|"failed"|"superseded";
export interface ScoutPositionProcessingJob {processingId?:string;id:string;positionId:string;stage:ScoutPositionProcessingStage;inputIdentity:string;attemptCount:number}
export interface ScoutBackfillStageStatus {pending:number;completed:number;failed:number;superseded:number}
export interface ScoutBackfillStatus {
 backfillRunId:string;
 sourceRunId:string;
 selection:{selected:number;complete:boolean};
 downstream:{pending:number;completed:number;failed:number;superseded:number;stages:Record<ScoutPositionProcessingStage,ScoutBackfillStageStatus>};
 descriptionRecovery:Array<{company:string;template:string;extractionStrategy:string;failureCode:string|null;recovered:number;unresolved:number}>;
}
export interface ScoutPositionEvaluationSummary {score:number|null;scoreExplanation:string|null;criteriaVersion:number|null;rubricVersion:number|null;profileVersion:string|null;model:string|null;provider:string|null}
export interface ScoutWorkspacePosition extends ScoutPositionEvaluationSummary {id:string;title:string;company:string;location:string|null;canonicalUrl:string;state:ScoutPositionState;stateRevision:number;processingStage:ScoutPositionProcessingStage|null;processingStatus:ScoutPositionProcessingStatus|null;processingFailureCode:string|null;processingFailureMessage:string|null;descriptionAvailable:boolean;firstSeenAt:string;lastSeenAt:string;observationCount:number}
export interface ScoutWorkspacePage {items:ScoutWorkspacePosition[];offset:number;limit:number;total:number;counts:Record<"actionable"|"processing"|"needs_user_review"|"irrelevant"|"deferred",number>}
export interface ScoutPositionDetail extends ScoutWorkspacePosition {externalId:string|null;sourceKey:string;descriptionId:string|null;descriptionMarkdown:string|null;descriptionSourceUrl:string|null;descriptionRetrievedAt:string|null;descriptionProvenance:unknown|null;relevanceEvaluationId:string|null;relevanceReason:string|null;candidateMatchEvaluationId:string|null;irrelevanceOrigin:"agent"|"user"|null;observations:Array<{id:string;runId:string;runCreatedAt:string;companyStatus:string;sourceKey:string;sourceStatus:string;title:string;canonicalUrl:string;location:string|null;observedAt:string;descriptionAvailable:boolean;provenance:unknown}>}
export interface ScoutReviewedRevision {expectedStateRevision:number;descriptionId:string;relevanceEvaluationId:string;candidateMatchEvaluationId:string}
export type ScoutUserDecisionCommand = ScoutReviewedRevision & {positionId:string;changeId:string;actor:string;action:"irrelevant"|"defer"|"pursue";note?:string;reviewAt?:string};
export interface ScoutPositionStore {
 pendingPositionJobs(limit:number):ScoutPositionProcessingJob[];
 markPositionJobsDispatched(processingIds:string[],now:string):void;
 reconcileGig(processing:string|ScoutPositionProcessingJob,now:string):void;
 failPositionProcessing(processing:string|ScoutPositionProcessingJob,code:string,message:string,now:string):void;
 backfillPositions(sourceRunId:string,limit:number,now:string):ScoutBackfillStatus;
 workspace(input:{text?:string;company?:string;state?:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}):ScoutWorkspacePage;
 positionDetail(id:string):ScoutPositionDetail|null;
 reviewDetail?(id:string):ScoutPositionDetail|null;
 decide(command:ScoutUserDecisionCommand,now:string):ScoutPositionDetail;
 restoreAgentIrrelevant(input:{positionId:string;changeId:string;actor:string;expectedStateRevision:number},now:string):ScoutPositionDetail;
 reverseDecision(input:{positionId:string;decisionId:string;changeId:string;actor:string;expectedStateRevision:number},now:string):ScoutPositionDetail;
 appendPositionNote(input:{positionId:string;decisionId?:string;actor:string;body:string},now:string):void;
 retryPromotion(positionId:string,now:string):ScoutPositionDetail|null;
 resurfaceDue(now:string):number;
 relevanceCriteria():{version:number;criteria:string;confidenceThreshold:number};
 appendRelevanceCriteria(criteria:string,confidenceThreshold:number,now:string):{version:number;criteria:string;confidenceThreshold:number};
}
export class ScoutPositionService {
 constructor(private readonly store:ScoutPositionStore){}
 list(input:Partial<{text:string;company:string;state:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}>={}){this.store.resurfaceDue(new Date().toISOString());const offset=input.offset??0,limit=input.limit??20;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error("Invalid Scout position pagination.");const state=input.state??"needs_user_review";if(!["actionable","processing","needs_user_review","deferred"].includes(state))throw new Error("Invalid Scout position state filter.");const sort=input.sort??"last_seen";if(!["last_seen","first_seen","company","title","state","score"].includes(sort))throw new Error("Invalid Scout position sort.");const direction=input.direction??"desc";if(direction!=="asc"&&direction!=="desc")throw new Error("Invalid Scout position sort direction.");return this.store.workspace({text:input.text?.trim().slice(0,200),company:input.company?.trim().slice(0,200),state,sort,direction,offset,limit});}
 get(id:string){return this.store.reviewDetail?.(id)??this.store.positionDetail(id);}
 decide(positionId:string,input:Omit<ScoutUserDecisionCommand,"positionId">){if(!input.changeId?.trim()||!input.actor?.trim())throw new Error("Decision change ID and actor are required.");if(input.note!==undefined&&(input.note.trim().length<1||input.note.length>2000))throw new Error("Decision note must contain 1 to 2000 characters.");if(input.action==="defer"&&(!input.reviewAt||Number.isNaN(Date.parse(input.reviewAt))))throw new Error("Defer requires a valid reviewAt timestamp.");return this.store.decide({...input,positionId,changeId:input.changeId.trim(),actor:input.actor.trim(),note:input.note?.trim()},new Date().toISOString());}
 restore(positionId:string,input:{changeId:string;actor:string;expectedStateRevision:number}){return this.store.restoreAgentIrrelevant({...input,positionId},new Date().toISOString());}
 reverse(positionId:string,input:{decisionId:string;changeId:string;actor:string;expectedStateRevision:number}){return this.store.reverseDecision({...input,positionId},new Date().toISOString());}
 addNote(positionId:string,input:{decisionId?:string;actor:string;body:string}){const body=input.body?.trim();if(!body||body.length>2000)throw new Error("Position note must contain 1 to 2000 characters.");this.store.appendPositionNote({...input,positionId,body},new Date().toISOString());return{ok:true};}
 retryPromotion(positionId:string){return this.store.retryPromotion(positionId,new Date().toISOString());}
 relevance(){return this.store.relevanceCriteria();}
 configureRelevance(input:{criteria:unknown;confidenceThreshold:unknown}){if(typeof input.criteria!=="string"||input.criteria.trim().length<10||input.criteria.length>4_000)throw new Error("Relevance criteria must contain 10 to 4000 characters.");if(typeof input.confidenceThreshold!=="number"||input.confidenceThreshold<0||input.confidenceThreshold>1)throw new Error("Relevance confidence threshold must be from 0 through 1.");return this.store.appendRelevanceCriteria(input.criteria.trim(),input.confidenceThreshold,new Date().toISOString());}
 backfill(sourceRunId:string,limit=100){if(!sourceRunId.trim())throw new Error("A source Scout run ID is required.");if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error("Backfill limit must be from 1 through 1000.");return this.store.backfillPositions(sourceRunId.trim(),limit,new Date().toISOString());}
}

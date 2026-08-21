export const scoutPositionStates = ["processing","needs_user_review","irrelevant","rejected","deferred","promoted"] as const;
export type ScoutPositionState = typeof scoutPositionStates[number];
export type ScoutPositionProcessingStage = "reconcile_gig"|"acquire_description"|"screen_relevance"|"score_candidate_match";
export type ScoutPositionProcessingStatus = "pending"|"completed"|"failed"|"superseded";
export interface ScoutPositionProcessingJob {processingId?:string;id:string;positionId:string;stage:ScoutPositionProcessingStage;inputIdentity:string;attemptCount:number}
export interface ScoutPositionEvaluationSummary {score:number|null;scoreExplanation:string|null;criteriaVersion:number|null;rubricVersion:number|null;profileVersion:string|null;model:string|null;provider:string|null}
export interface ScoutWorkspacePosition extends ScoutPositionEvaluationSummary {id:string;title:string;company:string;location:string|null;canonicalUrl:string;state:ScoutPositionState;processingStage:ScoutPositionProcessingStage|null;processingStatus:ScoutPositionProcessingStatus|null;processingFailureCode:string|null;processingFailureMessage:string|null;descriptionAvailable:boolean;firstSeenAt:string;lastSeenAt:string;observationCount:number}
export interface ScoutWorkspacePage {items:ScoutWorkspacePosition[];offset:number;limit:number;total:number;counts:Record<"actionable"|"processing"|"needs_user_review"|"irrelevant"|"deferred",number>}
export interface ScoutPositionDetail extends ScoutWorkspacePosition {externalId:string|null;sourceKey:string;observations:Array<{id:string;runId:string;runCreatedAt:string;companyStatus:string;sourceKey:string;sourceStatus:string;title:string;canonicalUrl:string;location:string|null;observedAt:string;descriptionAvailable:boolean;provenance:unknown}>}
export interface ScoutPositionStore {
 pendingPositionJobs(limit:number):ScoutPositionProcessingJob[];
 markPositionJobsDispatched(processingIds:string[],now:string):void;
 reconcileGig(processing:string|ScoutPositionProcessingJob,now:string):void;
 failPositionProcessing(processing:string|ScoutPositionProcessingJob,code:string,message:string,now:string):void;
 backfillPositions(sourceRunId:string,limit:number,now:string):{created:number;complete:boolean};
 workspace(input:{text?:string;company?:string;state?:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}):ScoutWorkspacePage;
 positionDetail(id:string):ScoutPositionDetail|null;
 relevanceCriteria():{version:number;criteria:string;confidenceThreshold:number};
 appendRelevanceCriteria(criteria:string,confidenceThreshold:number,now:string):{version:number;criteria:string;confidenceThreshold:number};
}
export class ScoutPositionService {
 constructor(private readonly store:ScoutPositionStore){}
 list(input:Partial<{text:string;company:string;state:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}>={}){const offset=input.offset??0,limit=input.limit??20;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error("Invalid Scout position pagination.");const state=input.state??"actionable";if(!["actionable","processing","needs_user_review","deferred"].includes(state))throw new Error("Invalid Scout position state filter.");const sort=input.sort??"last_seen";if(!["last_seen","first_seen","company","title","state","score"].includes(sort))throw new Error("Invalid Scout position sort.");const direction=input.direction??"desc";if(direction!=="asc"&&direction!=="desc")throw new Error("Invalid Scout position sort direction.");return this.store.workspace({text:input.text?.trim().slice(0,200),company:input.company?.trim().slice(0,200),state,sort,direction,offset,limit});}
 get(id:string){return this.store.positionDetail(id);}
 relevance(){return this.store.relevanceCriteria();}
 configureRelevance(input:{criteria:unknown;confidenceThreshold:unknown}){if(typeof input.criteria!=="string"||input.criteria.trim().length<10||input.criteria.length>4_000)throw new Error("Relevance criteria must contain 10 to 4000 characters.");if(typeof input.confidenceThreshold!=="number"||input.confidenceThreshold<0||input.confidenceThreshold>1)throw new Error("Relevance confidence threshold must be from 0 through 1.");return this.store.appendRelevanceCriteria(input.criteria.trim(),input.confidenceThreshold,new Date().toISOString());}
 backfill(sourceRunId:string,limit=100){if(!sourceRunId.trim())throw new Error("A source Scout run ID is required.");if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error("Backfill limit must be from 1 through 1000.");return this.store.backfillPositions(sourceRunId.trim(),limit,new Date().toISOString());}
}

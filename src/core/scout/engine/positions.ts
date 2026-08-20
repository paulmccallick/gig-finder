export const scoutPositionStates = ["processing","needs_user_review","irrelevant","rejected","deferred","promoted"] as const;
export type ScoutPositionState = typeof scoutPositionStates[number];
export type ScoutPositionProcessingStage = "reconcile_gig";
export type ScoutPositionProcessingStatus = "pending"|"completed"|"failed"|"superseded";
export interface ScoutPositionProcessingJob {id:string;positionId:string;stage:ScoutPositionProcessingStage;inputIdentity:string;attemptCount:number}
export interface ScoutWorkspacePosition {id:string;title:string;company:string;location:string|null;canonicalUrl:string;state:ScoutPositionState;processingStage:ScoutPositionProcessingStage|null;processingStatus:ScoutPositionProcessingStatus|null;processingFailureCode:string|null;processingFailureMessage:string|null;descriptionAvailable:boolean;firstSeenAt:string;lastSeenAt:string;observationCount:number}
export interface ScoutWorkspacePage {items:ScoutWorkspacePosition[];offset:number;limit:number;total:number;counts:Record<"actionable"|"processing"|"needs_user_review"|"irrelevant"|"deferred",number>}
export interface ScoutPositionDetail extends ScoutWorkspacePosition {externalId:string|null;sourceKey:string;observations:Array<{id:string;runId:string;runCreatedAt:string;companyStatus:string;sourceKey:string;sourceStatus:string;title:string;canonicalUrl:string;location:string|null;observedAt:string;descriptionAvailable:boolean;provenance:unknown}>}
export interface ScoutPositionStore {
 pendingPositionJobs(limit:number):ScoutPositionProcessingJob[];
 markPositionJobsDispatched(processingIds:string[],now:string):void;
 reconcileGig(job:ScoutPositionProcessingJob,now:string):void;
 failPositionProcessing(job:ScoutPositionProcessingJob,code:string,message:string,now:string):void;
 backfillPositions(limit:number,now:string):{created:number;complete:boolean};
 workspace(input:{text?:string;company?:string;state?:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}):ScoutWorkspacePage;
 positionDetail(id:string):ScoutPositionDetail|null;
}
export class ScoutPositionService {
 constructor(private readonly store:ScoutPositionStore){}
 list(input:Partial<{text:string;company:string;state:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}>={}){const offset=input.offset??0,limit=input.limit??20;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error("Invalid Scout position pagination.");const state=input.state??"actionable";if(!["actionable","processing","needs_user_review","irrelevant","deferred"].includes(state))throw new Error("Invalid Scout position state filter.");const sort=input.sort??"last_seen";if(!["last_seen","first_seen","company","title","state"].includes(sort))throw new Error("Invalid Scout position sort.");const direction=input.direction??"desc";if(direction!=="asc"&&direction!=="desc")throw new Error("Invalid Scout position sort direction.");return this.store.workspace({text:input.text?.trim().slice(0,200),company:input.company?.trim().slice(0,200),state,sort,direction,offset,limit});}
 get(id:string){return this.store.positionDetail(id);}
 backfill(limit=100){if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error("Backfill limit must be from 1 through 1000.");return this.store.backfillPositions(limit,new Date().toISOString());}
}

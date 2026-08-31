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
export interface ScoutPositionBackfillCommand {
 positionIds:string[];
 reason:string;
}
export interface ScoutPositionBackfillPreview {
 requested:number;
 accepted:Array<{positionId:string;company:string;title:string;state:ScoutPositionState;linkedGigId:string|null}>;
 rejected:Array<{positionId:string;code:"not_found"|"no_observation"|"no_active_configuration"|"description_acquisition_not_configured"|"description_identity_input_missing"}>;
}
export interface ScoutPositionBackfillStatus {
 runId:string;
 reason:string;
 status:"running"|"completed"|"partial"|"failed";
 completedAt:string|null;
 selection:{requested:number;accepted:number;rejected:number};
 stages:Record<ScoutPositionProcessingStage,ScoutBackfillStageStatus>;
 positionOutcomes:Record<string,number>;
 positions:Array<{positionId:string;company:string;template:string;descriptionOutcome:"corrected"|"unchanged"|null;outcome:string;failureCode:string|null}>;
 gigDocuments:{pending:number;updated:number;unchanged:number;failed:number};
}
export interface ScoutPositionEvaluationSummary {score:number|null;scoreExplanation:string|null;criteriaVersion:number|null;rubricVersion:number|null;profileVersion:string|null;model:string|null;provider:string|null}
export interface ScoutWorkspacePosition extends ScoutPositionEvaluationSummary {id:string;title:string;company:string;location:string|null;canonicalUrl:string;state:ScoutPositionState;stateRevision:number;processingStage:ScoutPositionProcessingStage|null;processingStatus:ScoutPositionProcessingStatus|null;processingFailureCode:string|null;processingFailureMessage:string|null;descriptionAvailable:boolean;firstSeenAt:string;lastSeenAt:string;observationCount:number}
export interface ScoutWorkspacePage {items:ScoutWorkspacePosition[];offset:number;limit:number;total:number;counts:Record<"actionable"|"processing"|"needs_user_review"|"irrelevant"|"deferred",number>}
export interface ScoutPositionDetail extends ScoutWorkspacePosition {externalId:string|null;sourceKey:string;descriptionId:string|null;descriptionMarkdown:string|null;descriptionSourceUrl:string|null;descriptionRetrievedAt:string|null;descriptionProvenance:unknown|null;relevanceEvaluationId:string|null;relevanceReason:string|null;candidateMatchEvaluationId:string|null;irrelevanceOrigin:"agent"|"user"|null;observations:Array<{id:string;runId:string;runCreatedAt:string;companyStatus:string;sourceKey:string;sourceStatus:string;title:string;canonicalUrl:string;location:string|null;observedAt:string;descriptionAvailable:boolean;provenance:unknown}>}
export interface ScoutReviewedRevision {expectedStateRevision:number;descriptionId:string;relevanceEvaluationId:string;candidateMatchEvaluationId:string}
export type ScoutUserDecisionCommand = ScoutReviewedRevision & {positionId:string;changeId:string;actor:string;action:"irrelevant"|"defer"|"pursue";note?:string;reviewAt?:string};
export interface ScoutPromotionWork {
 positionId:string; descriptionId:string; changeId:string; actor:string; gigId:string;
 company:string; title:string; externalId:string|null; location:string|null; sourceUrl:string;
 markdown:string; sourceDescription:string;
}
export interface ScoutPromotedDescriptionWork {
 processingId:string;
 positionId:string;
 gigId:string;
 managedDocumentId:string;
 markdown:string;
 sourceDescription:string;
 sourceProvenance:{
  officialUrl:string;
  retrievedAt:string;
  sourceContentHash:string;
  extractedContentHash:string;
  sourceKey:string;
  configurationVersion:number;
  extractionStrategy:string;
  converterVersion:string;
 };
 documentChangeId:string;
}
export type ScoutPromotedDescriptionOutcome="updated"|"unchanged";
export interface ScoutPositionStore {
 pendingPositionJobs(limit:number):ScoutPositionProcessingJob[];
 markPositionJobsDispatched(processingIds:string[],now:string):void;
 reconcileGig(processing:string|ScoutPositionProcessingJob,now:string):void;
 failPositionProcessing(processing:string|ScoutPositionProcessingJob,code:string,message:string,now:string):void;
 backfillPositions(sourceRunId:string,limit:number,now:string):ScoutBackfillStatus;
 previewBackfill(command:ScoutPositionBackfillCommand):ScoutPositionBackfillPreview;
 startBackfill(command:ScoutPositionBackfillCommand,now:string):ScoutPositionBackfillStatus;
 backfillStatus(runId:string):ScoutPositionBackfillStatus|null;
 workspace(input:{text?:string;company?:string;state?:string;sort:string;direction:"asc"|"desc";offset:number;limit:number}):ScoutWorkspacePage;
 positionDetail(id:string):ScoutPositionDetail|null;
 reviewDetail?(id:string):ScoutPositionDetail|null;
 decide(command:ScoutUserDecisionCommand,now:string):ScoutPositionDetail;
 restoreAgentIrrelevant(input:{positionId:string;changeId:string;actor:string;expectedStateRevision:number},now:string):ScoutPositionDetail;
 reverseDecision(input:{positionId:string;decisionId:string;changeId:string;actor:string;expectedStateRevision:number},now:string):ScoutPositionDetail;
 appendPositionNote(input:{positionId:string;decisionId?:string;actor:string;body:string},now:string):void;
 promotionWork(positionId:string):ScoutPromotionWork|null;
 failPromotion(positionId:string,message:string,now:string):void;
 completePromotion(positionId:string,gigId:string,managedDocumentId:string,now:string):void;
 resurfaceDue(now:string):number;
 relevanceCriteria():{version:number;criteria:string;confidenceThreshold:number};
 appendRelevanceCriteria(criteria:string,confidenceThreshold:number,now:string):{version:number;criteria:string;confidenceThreshold:number};
}

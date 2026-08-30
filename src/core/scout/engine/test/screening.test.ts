import { describe, expect, test } from "bun:test";
import { MutationError } from "../../../errors";
import type { ManagedDocumentRecord } from "../../../documents";
import type { ScoutPromotedDescriptionWork } from "../positions";
import { ScoutPositionProcessor, candidateMatchResultSchema, relevanceResultSchema, type ScoutPositionProcessingRepository, type ScoutScreeningModel } from "../screening";

const evaluation={positionId:"position-1",title:"Director of Facilities",company:"Example",location:"Remote",officialUrl:"https://example.test/job",descriptionMarkdown:"Leads facilities.",descriptionArtifactId:"artifact-1",descriptionHash:"hash-1"};
function repository(stage:"screen_relevance"|"score_candidate_match",events:string[]){return{stage:()=>stage,screeningModelIdentity:()=>null,reconcileGig(){throw new Error("unexpected");},descriptionInput(){throw new Error("unexpected");},acquireDescription(){throw new Error("unexpected");},prepareDescriptionCompletion(){throw new Error("unexpected");},completeDescription(){throw new Error("unexpected");},failDescriptionProjection(){throw new Error("unexpected");},relevanceInput:()=>({...evaluation,criteria:"Technology leadership only",criteriaVersion:1,promptVersion:"relevance-v1",confidenceThreshold:.85}),completeRelevance(_id,_result,irrelevant){events.push(irrelevant?"irrelevant":"passed");},refreshCandidateMatch(){return false;},candidateMatchInput:()=>({...evaluation,profile:{synthetic:true},profileVersion:"profile-v1",profileArtifactId:"profile-artifact",profileHash:"profile-hash",promptCacheKey:"run-cache-key",rubric:"Synthetic rubric",rubricVersion:1,promptVersion:"match-v1",relevanceEvaluationId:"relevance-1"}),completeCandidateMatch(_id,result){events.push(`score:${result.value.score}`);},failPositionProcessing(){}} as ScoutPositionProcessingRepository;}
const model:ScoutScreeningModel={async screenRelevance(){return{value:{decision:"fails_relevance",reason:"The role is not clearly technical.",confidence:.84,evidence:["Non-technical scope"],ambiguities:[]},metrics:{provider:"test",model:"test",modelConfiguration:"test",inputTokens:1,outputTokens:1,latencyMs:1}};},async scoreCandidateMatch(){return{value:{score:7,scoreExplanation:"Synthetic score explanation"},metrics:{provider:"test",model:"test",modelConfiguration:"test",inputTokens:1,outputTokens:1,latencyMs:1}};}};

describe("Scout position screening policy",()=>{
 test("uncertain relevance failures pass the exclusion gate",async()=>{const events:string[]=[];await new ScoutPositionProcessor(repository("screen_relevance",events),model).process("processing-1");expect(events).toEqual(["passed"]);});
 test("candidate match is a separate structured stage",async()=>{const events:string[]=[];await new ScoutPositionProcessor(repository("score_candidate_match",events),model).process("processing-2");expect(events).toEqual(["score:7"]);});
 test("position backfill selects its snapshotted model before relevance and scoring",async()=>{
  const selected={provider:"provider-original",model:"model-original",modelConfiguration:"configuration-original"};
  const selections:Array<typeof selected>=[],events:string[]=[];
  const currentModel:ScoutScreeningModel={async screenRelevance(){throw new Error("current relevance model must not run");},async scoreCandidateMatch(){throw new Error("current scoring model must not run");}};
  const selectedModel:ScoutScreeningModel={
   async screenRelevance(){events.push("selected-relevance");return{value:{decision:"passes_relevance",reason:"Selected model relevance",confidence:.99,evidence:[],ambiguities:[]},metrics:{...selected,inputTokens:1,outputTokens:1,latencyMs:1}};},
   async scoreCandidateMatch(){events.push("selected-score");return{value:{score:9,scoreExplanation:"Selected model score"},metrics:{...selected,inputTokens:1,outputTokens:1,latencyMs:1}};},
  };
  const relevanceRepository={...repository("screen_relevance",events),screeningModelIdentity:()=>selected};
  const scoreRepository={...repository("score_candidate_match",events),screeningModelIdentity:()=>selected};
  const selector=(identity:typeof selected)=>{selections.push(identity);return selectedModel;};
  await new ScoutPositionProcessor(relevanceRepository,currentModel,()=>"2026-08-29T00:00:00Z",selector).process("relevance-after-restart");
  await new ScoutPositionProcessor(scoreRepository,currentModel,()=>"2026-08-29T00:00:01Z",selector).process("score-after-restart");
  expect(selections).toEqual([selected,selected]);
  expect(events).toEqual(["selected-relevance","passed","selected-score","score:9"]);
 });
 test("strict contracts reject unknown fields and non-integer scores",()=>{expect(relevanceResultSchema.safeParse({decision:"passes_relevance",reason:"Synthetic reason",confidence:.5,evidence:[],ambiguities:[],extra:true}).success).toBeFalse();expect(candidateMatchResultSchema.safeParse({score:7.5,scoreExplanation:"No"}).success).toBeFalse();});
 test("comments are required and bounded for durable storage",()=>{
  expect(relevanceResultSchema.safeParse({decision:"passes_relevance",reason:"x".repeat(255),confidence:.5,evidence:[],ambiguities:[]}).success).toBeTrue();
  expect(relevanceResultSchema.safeParse({decision:"passes_relevance",reason:"x".repeat(256),confidence:.5,evidence:[],ambiguities:[]}).success).toBeFalse();
  expect(candidateMatchResultSchema.safeParse({score:7,scoreExplanation:"x".repeat(310)}).success).toBeTrue();
  expect(candidateMatchResultSchema.safeParse({score:7,scoreExplanation:"x".repeat(311)}).success).toBeFalse();
 });
});

const promotedDescriptionWork:ScoutPromotedDescriptionWork={
 processingId:"processing-promoted",
 positionId:"position-promoted",
 gigId:"gig-promoted",
 managedDocumentId:"doc_00000000-0000-4000-8000-000000000143",
 expectedDocumentVersion:1,
 markdown:"Corrected official description.",
 sourceDescription:"Gig Scout official posting retrieved from official configuration 2.",
 sourceProvenance:{officialUrl:"https://example.test/jobs/promoted",retrievedAt:"2026-08-29T01:00:00Z",sourceContentHash:"a".repeat(64),extractedContentHash:"b".repeat(64),sourceKey:"official",configurationVersion:2,extractionStrategy:"json-field-v1",converterVersion:"scout-description-v2"},
 documentChangeId:"change_promoted_description",
};

const promotedDocument=(content:string,currentVersion:number):ManagedDocumentRecord=>({
 id:promotedDescriptionWork.managedDocumentId,
 links:[{entityType:"gig",entityId:promotedDescriptionWork.gigId}],
 documentType:"job_description",
 title:"Example — Director",
 description:null,
 mediaType:"text/markdown",
 sourceDescription:"Initial Scout source",
 filePath:null,
 uploadProvenance:null,
 displayName:"Example — Director",
 currentVersion,
 content,
 contentHash:"hash",
 createdAt:"2026-08-28T01:00:00Z",
 updatedAt:"2026-08-28T01:00:00Z",
});

function promotedRepository(events:string[]){
 let active=true;
 return{
  stage:()=>active?"acquire_description" as const:null,
  screeningModelIdentity:()=>null,
  reconcileGig(){throw new Error("unexpected");},
  descriptionInput:()=>({positionId:"position-promoted",externalId:"143",title:"Director",company:"Example",location:"Remote",officialUrl:"https://example.test/jobs/promoted",existingDescriptionId:null,detailPlan:null}),
  async acquireDescription(){events.push("acquired");return{markdown:promotedDescriptionWork.markdown,sourceContentHash:promotedDescriptionWork.sourceProvenance.sourceContentHash,extractedContentHash:promotedDescriptionWork.sourceProvenance.extractedContentHash,sourceUrl:promotedDescriptionWork.sourceProvenance.officialUrl,retrievedAt:promotedDescriptionWork.sourceProvenance.retrievedAt,converterVersion:promotedDescriptionWork.sourceProvenance.converterVersion,strategyVersion:promotedDescriptionWork.sourceProvenance.extractionStrategy};},
  prepareDescriptionCompletion(){events.push("prepared");return{descriptionId:"description-promoted",promotedDocument:promotedDescriptionWork};},
  completeDescription(_processingId:string,_descriptionId:string,outcome:"updated"|"unchanged"|null){events.push(`completed:${outcome}`);active=false;},
  failDescriptionProjection(_processingId:string,code:string){events.push(`failed:${code}`);},
  relevanceInput(){throw new Error("unexpected");},
  completeRelevance(){throw new Error("unexpected");},
  refreshCandidateMatch(){throw new Error("unexpected");},
  candidateMatchInput(){throw new Error("unexpected");},
  completeCandidateMatch(){throw new Error("unexpected");},
  failPositionProcessing(){throw new Error("unexpected");},
 } satisfies ScoutPositionProcessingRepository;
}

describe("promoted description managed-document projection",()=>{
 test("updates the exact linked Gig job-description document before completing acquisition",async()=>{
  const events:string[]=[];
  let document=promotedDocument("Original official description.",1);
  const documents={
   get(id:string){expect(id).toBe(promotedDescriptionWork.managedDocumentId);events.push("document:get");return document;},
   update(context:Parameters<import("../../../managed-document-service").ManagedDocumentService["update"]>[0],input:Parameters<import("../../../managed-document-service").ManagedDocumentService["update"]>[1]){
    expect(context).toEqual({actor:"Gig Scout",source:"automation",summary:"Refresh promoted Gig job description",changeId:promotedDescriptionWork.documentChangeId,occurredAt:"2026-08-29T01:00:01Z"});
    expect(input).toEqual({documentId:promotedDescriptionWork.managedDocumentId,expectedVersion:1,content:promotedDescriptionWork.markdown,changeSummary:"Refresh from current official Scout posting",sourceDescription:promotedDescriptionWork.sourceDescription,sourceProvenance:promotedDescriptionWork.sourceProvenance});
    events.push("document:update");
    document={...document,currentVersion:2,content:input.content};
    return{document,changeId:context.changeId??null,changed:true};
   },
  };

  await new ScoutPositionProcessor(promotedRepository(events),model,()=>"2026-08-29T01:00:01Z",undefined,documents).process(promotedDescriptionWork.processingId);

  expect(events).toEqual(["acquired","prepared","document:get","document:update","completed:updated"]);
 });

 test("records unchanged content without creating a managed-document version",async()=>{
  const events:string[]=[];
  const document=promotedDocument(promotedDescriptionWork.markdown,4);
  const documents={get(){events.push("document:get");return document;},update(){events.push("document:update");return{document,changeId:null,changed:false};}};

  await new ScoutPositionProcessor(promotedRepository(events),model,()=>"2026-08-29T01:00:02Z",undefined,documents).process(promotedDescriptionWork.processingId);

  expect(events).toEqual(["acquired","prepared","document:get","document:update","completed:unchanged"]);
 });

 test("rejects a document that is not the exact linked Gig Markdown job description",async()=>{
  const events:string[]=[];
  const document={...promotedDocument("Original official description.",1),links:[{entityType:"gig" as const,entityId:"another-gig"}]};
  const documents={get(){events.push("document:get");return document;},update(){events.push("document:update");return{document,changeId:promotedDescriptionWork.documentChangeId,changed:true};}};

  await expect(new ScoutPositionProcessor(promotedRepository(events),model,()=>"2026-08-29T01:00:02Z",undefined,documents).process(promotedDescriptionWork.processingId)).rejects.toThrow("durable Scout link");

  expect(events).toEqual(["acquired","prepared","document:get","failed:document_projection_failed"]);
 });

 test("leaves a revision conflict retryable and converges on the current document version",async()=>{
  const events:string[]=[];
  let document=promotedDocument("Original official description.",1),conflict=true,automatedVersions=0;
  const documents={
   get(){events.push(`document:get:${document.currentVersion}`);return document;},
   update(_context:unknown,input:{expectedVersion:number;content:string}){
    events.push(`document:update:${input.expectedVersion}`);
    if(conflict){conflict=false;document={...document,currentVersion:2,content:"Concurrent user edit."};throw new MutationError("revision_conflict","Synthetic document revision conflict.");}
    automatedVersions++;
    document={...document,currentVersion:input.expectedVersion+1,content:input.content};
    return{document,changeId:promotedDescriptionWork.documentChangeId,changed:true};
   },
  };
  const repository=promotedRepository(events);
  const processor=new ScoutPositionProcessor(repository,model,()=>"2026-08-29T01:00:03Z",undefined,documents);

  await expect(processor.process(promotedDescriptionWork.processingId)).rejects.toThrow("revision conflict");
  await processor.process(promotedDescriptionWork.processingId);

  expect(events).toEqual(["acquired","prepared","document:get:1","document:update:1","failed:revision_conflict","acquired","prepared","document:get:2","document:update:2","completed:updated"]);
  expect({automatedVersions,version:document.currentVersion,content:document.content}).toEqual({automatedVersions:1,version:3,content:promotedDescriptionWork.markdown});
 });
});

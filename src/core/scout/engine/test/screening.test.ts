import { describe, expect, test } from "bun:test";
import { ScoutPositionProcessor, candidateMatchResultSchema, relevanceResultSchema, type ScoutPositionProcessingRepository, type ScoutScreeningModel } from "../screening";

const evaluation={positionId:"position-1",title:"Director of Facilities",company:"Example",location:"Remote",officialUrl:"https://example.test/job",descriptionMarkdown:"Leads facilities.",descriptionArtifactId:"artifact-1",descriptionHash:"hash-1"};
function repository(stage:"screen_relevance"|"score_candidate_match",events:string[]){return{stage:()=>stage,reconcileGig(){throw new Error("unexpected");},descriptionInput(){throw new Error("unexpected");},acquireDescription(){throw new Error("unexpected");},completeDescription(){throw new Error("unexpected");},relevanceInput:()=>({...evaluation,criteria:"Technology leadership only",criteriaVersion:1,promptVersion:"relevance-v1",confidenceThreshold:.85}),completeRelevance(_id,_result,irrelevant){events.push(irrelevant?"irrelevant":"passed");},candidateMatchInput:()=>({...evaluation,profile:{synthetic:true},profileVersion:"profile-v1",profileArtifactId:"profile-artifact",profileHash:"profile-hash",promptCacheKey:"run-cache-key",rubric:"Synthetic rubric",rubricVersion:1,promptVersion:"match-v1",relevanceEvaluationId:"relevance-1"}),completeCandidateMatch(_id,result){events.push(`score:${result.value.score}`);},failPositionProcessing(){}} as ScoutPositionProcessingRepository;}
const model:ScoutScreeningModel={async screenRelevance(){return{value:{decision:"fails_relevance",reason:"The role is not clearly technical.",confidence:.84,evidence:["Non-technical scope"],ambiguities:[]},metrics:{provider:"test",model:"test",modelConfiguration:"test",inputTokens:1,outputTokens:1,latencyMs:1}};},async scoreCandidateMatch(){return{value:{score:7,scoreExplanation:"Synthetic score explanation"},metrics:{provider:"test",model:"test",modelConfiguration:"test",inputTokens:1,outputTokens:1,latencyMs:1}};}};

describe("Scout position screening policy",()=>{
 test("uncertain relevance failures pass the exclusion gate",async()=>{const events:string[]=[];await new ScoutPositionProcessor(repository("screen_relevance",events),model).process("processing-1");expect(events).toEqual(["passed"]);});
 test("candidate match is a separate structured stage",async()=>{const events:string[]=[];await new ScoutPositionProcessor(repository("score_candidate_match",events),model).process("processing-2");expect(events).toEqual(["score:7"]);});
 test("strict contracts reject unknown fields and non-integer scores",()=>{expect(relevanceResultSchema.safeParse({decision:"passes_relevance",reason:"Synthetic reason",confidence:.5,evidence:[],ambiguities:[],extra:true}).success).toBeFalse();expect(candidateMatchResultSchema.safeParse({score:7.5,scoreExplanation:"No"}).success).toBeFalse();});
 test("comments are required and bounded for durable storage",()=>{
  expect(relevanceResultSchema.safeParse({decision:"passes_relevance",reason:"x".repeat(255),confidence:.5,evidence:[],ambiguities:[]}).success).toBeTrue();
  expect(relevanceResultSchema.safeParse({decision:"passes_relevance",reason:"x".repeat(256),confidence:.5,evidence:[],ambiguities:[]}).success).toBeFalse();
  expect(candidateMatchResultSchema.safeParse({score:7,scoreExplanation:"x".repeat(310)}).success).toBeTrue();
  expect(candidateMatchResultSchema.safeParse({score:7,scoreExplanation:"x".repeat(311)}).success).toBeFalse();
 });
});

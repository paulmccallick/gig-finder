import { expect, test } from "bun:test";
import { AiSdkScoutScreeningModel, candidateMatchModelPayload, candidateMatchPromptCacheKey, relevanceModelPayload, scoutCandidateMatchInstructions, scoutCandidateMatchPromptVersion, scoutRelevanceInstructions, scoutRelevancePromptVersion } from "../scout-position-screening";
import { createCodexLanguageModel } from "../codex-provider";
import { createSmokeProviderState, smokeProviderHandler } from "../../../scripts/smoke-support/scripted-provider";

test("Scout screening owns dedicated versioned instructions without tools or conversation policy",()=>{expect(scoutRelevancePromptVersion).toBe("scout-relevance-v1");expect(scoutCandidateMatchPromptVersion).toBe("scout-candidate-match-v1");expect(scoutRelevanceInstructions).toContain("narrow relevance");expect(scoutRelevanceInstructions).toContain("Do not assess candidate fit");expect(scoutCandidateMatchInstructions).toContain("exact description and profile versions");expect(scoutRelevanceInstructions).not.toContain("get_gigs");});

test("model payloads exclude application bookkeeping",()=>{
 const position={positionId:"INTERNAL_POSITION",title:"Director of Synthetic Technology",company:"Example",location:"Remote",officialUrl:"https://example.test/role",descriptionMarkdown:"Complete description",descriptionArtifactId:"INTERNAL_ARTIFACT",descriptionHash:"INTERNAL_DESCRIPTION_HASH"};
 const relevance=JSON.stringify(relevanceModelPayload({...position,criteria:"Technology leadership",criteriaVersion:42,promptVersion:"INTERNAL_PROMPT_VERSION"}));
 const scoring=JSON.stringify(candidateMatchModelPayload({...position,profile:{summary:"Synthetic profile"},profileVersion:"INTERNAL_PROFILE_VERSION",profileArtifactId:"INTERNAL_PROFILE_ARTIFACT",profileHash:"INTERNAL_PROFILE_HASH",promptCacheKey:"INTERNAL_CACHE_KEY",rubric:"Candidate match",rubricVersion:43,promptVersion:"INTERNAL_MATCH_PROMPT",relevanceEvaluationId:"INTERNAL_RELEVANCE_EVALUATION"}));
 expect(relevance).toContain("Complete description");
 expect(scoring).toContain("Synthetic profile");
 for(const internal of ["INTERNAL_POSITION","INTERNAL_ARTIFACT","INTERNAL_DESCRIPTION_HASH","INTERNAL_PROMPT_VERSION","INTERNAL_PROFILE_VERSION","INTERNAL_PROFILE_ARTIFACT","INTERNAL_PROFILE_HASH","INTERNAL_CACHE_KEY","INTERNAL_MATCH_PROMPT","INTERNAL_RELEVANCE_EVALUATION"]){expect(relevance).not.toContain(internal);expect(scoring).not.toContain(internal);}
});

test("candidate scoring keeps the cached profile prefix stable across variable positions",async()=>{
 const shared={descriptionArtifactId:"artifact",descriptionHash:"hash",profile:{summary:"Stable synthetic profile"},profileVersion:"profile-v1",profileArtifactId:"profile-artifact",profileHash:"profile-hash",promptCacheKey:"run-cache-key",rubric:"Stable rubric",rubricVersion:2,promptVersion:"match-v2",relevanceEvaluationId:"relevance"};
 const first={...shared,positionId:"one",title:"Director One",company:"Example",location:"Remote",officialUrl:"https://example.test/one",descriptionMarkdown:"First description"};
 const second={...shared,positionId:"two",title:"Director Two",company:"Example",location:"Remote",officialUrl:"https://example.test/two",descriptionMarkdown:"Second description"};
 const firstPayload=candidateMatchModelPayload(first),secondPayload=candidateMatchModelPayload(second);
 expect(firstPayload.stablePrefix).toEqual(secondPayload.stablePrefix);
 expect(firstPayload.variableSuffix).not.toEqual(secondPayload.variableSuffix);
 expect(await candidateMatchPromptCacheKey(first)).toBe(await candidateMatchPromptCacheKey(second));
 expect(candidateMatchPromptCacheKey({...second,promptCacheKey:"another-run-cache-key"})).not.toBe(candidateMatchPromptCacheKey(first));
});

test("dedicated structured calls traverse the provider adapter without tools",async()=>{
 const state=createSmokeProviderState(),server=Bun.serve({port:0,fetch:smokeProviderHandler(state)});
 try{
  const model=new AiSdkScoutScreeningModel(()=>createCodexLanguageModel("gpt-5.6-sol",{smokeBaseURL:`http://127.0.0.1:${server.port}`}),{provider:"synthetic",model:"gpt-5.6-sol",configuration:"structured-v1"});
  const position={positionId:"position",title:"Director of Technology",company:"Example",location:"Remote",officialUrl:"https://example.test/role",descriptionMarkdown:"Lead software engineering.",descriptionArtifactId:"artifact",descriptionHash:"hash"};
  const relevance=await model.screenRelevance({...position,criteria:"Technology leadership",criteriaVersion:1,promptVersion:"relevance-v1"});
  expect(relevance.value.decision).toBe("passes_relevance");
  const score=await model.scoreCandidateMatch({...position,profile:{summary:"Synthetic leader"},profileVersion:"profile-v1",profileArtifactId:"profile-artifact",profileHash:"profile-hash",promptCacheKey:"run-cache-key",rubric:"Score leadership fit",rubricVersion:1,promptVersion:"match-v1",relevanceEvaluationId:"relevance"});
  expect(score.value).toMatchObject({score:8});
  const scoringRequest=state.requestBodies[1]!,serialized=JSON.stringify(scoringRequest);
  expect(scoringRequest.tools).toBeUndefined();
  expect(scoringRequest.max_output_tokens).toBeUndefined();
  expect(typeof scoringRequest.prompt_cache_key).toBe("string");
  expect(serialized.indexOf("Synthetic leader")).toBeLessThan(serialized.indexOf("Lead software engineering"));
  for(const internal of ["profile-artifact","profile-hash","match-v1","relevance"]){expect(serialized).not.toContain(internal);}
 }finally{await server.stop(true);}
});

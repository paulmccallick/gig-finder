import { afterEach, expect, test } from "bun:test";
import { openDatabase, migrateDatabase } from "../database";
import { SqliteScoutCompanyImportStore } from "../scout-company-import-store";
import { SqliteScoutRunStore } from "../scout-run-store";
import {DataStore} from "../store";
import { importScoutCompany } from "../../core/scout/engine/company-import";
import { ScoutPositionProcessor, type ScoutScreeningModel } from "../../core/scout/engine/screening";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryDirectories:string[]=[];
afterEach(() => {databases.splice(0).forEach((db) => db.close());temporaryDirectories.splice(0).forEach(directory=>rmSync(directory,{recursive:true,force:true}));});
function setup() {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrateDatabase(db);
  importScoutCompany(
    {
      id: "company-1",
      name: "Example Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json",
          url: "https://careers.example.test/jobs",
          recordsPath: "jobs",
          fields: { id: "id", title: "title", url: "url" },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(db),
  );
  return new SqliteScoutRunStore(db);
}
test("full-run creation is singleton guarded and outbox jobs carry immutable configuration", () => {
  const store = setup();
  const first = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z");
  const second = store.startOrReuse(99, 9, "2026-01-01T00:01:00Z");
  expect(first.created).toBeTrue();
  expect(second).toEqual({ run: first.run, created: false });
  const jobs = store.pendingJobs(20);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.sources[0]?.key).toBe("official");
});
test("a run-owned search profile is dispatched uniformly without changing company configuration", () => {
  const store = setup();
  store.startOrReuse(20, 5, "2026-01-01T00:00:00Z", {
    terms: ["synthetic specialty"],
    locations: ["Synthetic Region"],
  });
  const job = store.pendingJobs(1)[0]!;
  expect(job.searchProfile).toEqual({
    terms: ["synthetic specialty"],
    locations: ["Synthetic Region"],
  });
  expect(store.list()[0]?.searchProfile).toEqual(job.searchProfile);
  expect(store.get(job.runId)?.searchProfile).toEqual(job.searchProfile);
  expect(job.sources[0]).not.toHaveProperty("searchTerms");
  expect(job.sources[0]).not.toHaveProperty("maxPages");
});
test("each Scout run durably snapshots its profile with a distinct cache key",()=>{
  setup();const database=databases.at(-1)!;
  const screening=(version:string)=>({profile:{version,summary:`Synthetic ${version}`},profileVersion:version,profileArtifactId:`artifact-${version}`,profileHash:`hash-${version}`,model:"synthetic-model",provider:"synthetic-provider",modelConfiguration:"structured-v1"});
  const firstStore=new SqliteScoutRunStore(database,undefined,screening("profile-v1"));
  const first=firstStore.startOrReuse(20,5,"2026-01-01T00:00:00Z").run;
  database.query(`UPDATE scout_runs SET status='completed',completed_at='2026-01-01T00:01:00Z' WHERE id=?`).run(first.id);
  const secondStore=new SqliteScoutRunStore(database,undefined,screening("profile-v2"));
  const second=secondStore.startOrReuse(20,5,"2026-01-01T00:02:00Z").run;
  const rows=database.query(`SELECT id,screening_cache_key cacheKey,candidate_profile_version profileVersion,candidate_profile_json profileJson FROM scout_runs WHERE id IN (?,?) ORDER BY created_at`).all(first.id,second.id) as Array<{id:string;cacheKey:string;profileVersion:string;profileJson:string}>;
  expect(rows.map(row=>row.cacheKey)).toHaveLength(2);
  expect(rows[0]!.cacheKey).not.toBe(rows[1]!.cacheKey);
  expect(rows.map(row=>row.profileVersion)).toEqual(["profile-v1","profile-v2"]);
  expect(JSON.parse(rows[0]!.profileJson)).toMatchObject({summary:"Synthetic profile-v1"});
});
test("terminal redelivery is idempotent and historical positions are stable", () => {
  const store = setup();
  const run = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z").run;
  const job = store.pendingJobs(1)[0]!;
  const result = {
    companyId: job.companyId,
    configurationVersionId: job.configurationVersionId,
    positions: [
      {
        sourceKey: "official",
        externalId: "role-1",
        canonicalUrl: "https://careers.example.test/jobs/1",
        title: "Systems Gardener",
        location: "Remote",
        description: null,
        provenance: {
          sourceKey: "official",
          sourceUrl: "https://careers.example.test/jobs",
          description: "none" as const,
          descriptionUrl: "https://careers.example.test/jobs/1",
        },
      },
    ],
    sources: [
      {
        sourceKey: "official",
        status: "succeeded_with_results" as const,
        positions: [] as never[],
        attempts: [
          {
            sourceMethod: "json" as const,
            stage: "listing-retry",
            requestCount: 1,
            responseCount: 0,
            candidateCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            validationStatus: "failed" as const,
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:00Z",
            failure: { code: "temporary", message: "Retryable" },
            diagnostics: [
              {
                code: "synthetic_retry",
                category: "network" as const,
                count: 1,
                message: "Synthetic retry evidence.",
              },
            ],
          },
          {
            sourceMethod: "json" as const,
            stage: "listing",
            requestCount: 1,
            responseCount: 1,
            candidateCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            validationStatus: "verified" as const,
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:01Z",
            diagnostics: [],
          },
        ],
      },
    ],
  };
  result.sources[0]!.positions = result.positions as never[];
  store.commitResult(job, result, "2026-01-01T00:00:01Z");
  store.commitResult(job, result, "2026-01-01T00:00:02Z");
  const detail = store.get(run.id)!;
  expect(detail.status).toBe("completed");
  expect(detail.companies[0]?.sources[0]).toMatchObject({
    candidateCount: 1,
    acceptedCount: 1,
  });
  expect(detail.companies[0]?.sources[0]?.attempts).toHaveLength(2);
  expect(
    detail.companies[0]?.sources[0]?.attempts[0]?.diagnostics,
  ).toContainEqual(
    expect.objectContaining({ code: "synthetic_retry", count: 1 }),
  );
  expect(store.positions(run.id, { offset: 0, limit: 20 }).items).toHaveLength(
    1,
  );
  expect(store.workspace({state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20})).toMatchObject({total:1,counts:{actionable:1,processing:1}});
  const processing=store.pendingPositionJobs(20);
  expect(processing).toHaveLength(1);
  store.reconcileGig(processing[0]!,"2026-01-01T00:00:03Z");
  expect(store.pendingPositionJobs(20)).toEqual([
    expect.objectContaining({ stage: "acquire_description" }),
  ]);
  expect(store.backfillPositions(run.id,20,"2026-01-01T00:00:04Z")).toEqual({created:0,complete:true});
  expect(store.backfillPositions(run.id,20,"2026-01-01T00:00:04.500Z")).toEqual({created:0,complete:true});
  const position=store.workspace({state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20}).items[0]!;
  expect(store.positionDetail(position.id)?.observations).toHaveLength(1);
  expect(store.workspace({text:"does not match",state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20}).counts).toEqual({actionable:0,processing:0,needs_user_review:0,irrelevant:0,deferred:0});
  new DataStore(databases.at(-1)!).change({actor:"Synthetic test",source:"test",summary:"Create exact Gig"},transaction=>transaction.gigs.create({id:"gig-exact",company:"Example Company",title:"Systems Gardener",externalJobId:"role-1",stage:"identified",outcome:"pending",statusSummary:"Tracked",lastActivity:"2026-01-01",nextActionDescription:null,nextActionDue:null,fitRating:"good",fitSummary:null,payCurrency:null,payMinimum:null,payMaximum:null,payPeriod:null,payNotes:null,sourceUrl:null,location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null,tagsJson:"[]",hasJobDescription:false,hasInterviewPrep:false}));
  expect(store.backfillPositions(run.id,20,"2026-01-01T00:00:05Z")).toEqual({created:1,complete:true});
  store.reconcileGig(store.pendingPositionJobs(20)[0]!,"2026-01-01T00:00:06Z");
  expect(store.workspace({state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20}).total).toBe(0);
  expect(databases.at(-1)!.query("SELECT state,linked_gig_id linkedGigId,revision FROM scout_position_states WHERE position_id=?").get(position.id)).toEqual({state:"promoted",linkedGigId:"gig-exact",revision:2});
});
test("partial source outcomes roll up explicitly", () => {
  const store = setup();
  const run = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z").run;
  const job = store.pendingJobs(1)[0]!;
  store.commitResult(
    job,
    {
      companyId: job.companyId,
      configurationVersionId: job.configurationVersionId,
      positions: [],
      sources: [
        {
          sourceKey: "official",
          status: "partial",
          positions: [],
          attempts: [
            {
              sourceMethod: "json",
              stage: "listing_page_2",
              requestCount: 1,
              responseCount: 0,
              candidateCount: 0,
              acceptedCount: 0,
              rejectedCount: 0,
              validationStatus: "failed",
              startedAt: "2026-01-01T00:00:00Z",
              completedAt: "2026-01-01T00:00:01Z",
              failure: {
                code: "source_attempt_failed",
                message: "Synthetic failure",
              },
              diagnostics: [],
            },
          ],
        },
      ],
    },
    "2026-01-01T00:00:01Z",
  );
  expect(store.get(run.id)?.status).toBe("partial");
  expect(store.get(run.id)?.companies[0]?.status).toBe("partial");
});

test("screening persists bounded comments and exposes only the score explanation",async()=>{
  setup();
  const database=databases.at(-1)!;
  const descriptionsRoot=mkdtempSync(path.join(process.cwd(),"tmp","scout-screening-test-"));
  temporaryDirectories.push(descriptionsRoot);
  mkdirSync(descriptionsRoot,{recursive:true});
  const screening={profile:{candidate:"Synthetic Candidate"},profileVersion:"profile-v1",profileArtifactId:"profile-artifact-v1",profileHash:"profile-hash-v1",model:"synthetic-model",provider:"synthetic-provider",modelConfiguration:"temperature=0"};
  const store=new SqliteScoutRunStore(database,descriptionsRoot,screening);
  const run=store.startOrReuse(20,5,"2026-01-01T00:00:00Z").run;
  const job=store.pendingJobs(1)[0]!;
  const position={sourceKey:"official",externalId:"screen-1",canonicalUrl:"https://careers.example.test/jobs/screen-1",title:"Director of Synthetic Technology",location:"Remote",description:"Lead the synthetic technology organization.",provenance:{sourceKey:"official",sourceUrl:"https://careers.example.test/jobs",description:"listing" as const,descriptionUrl:"https://careers.example.test/jobs/screen-1"}};
  store.commitResult(job,{companyId:job.companyId,configurationVersionId:job.configurationVersionId,positions:[position],sources:[{sourceKey:"official",status:"succeeded_with_results",positions:[position],attempts:[{sourceMethod:"json",stage:"listing",requestCount:1,responseCount:1,candidateCount:1,acceptedCount:1,rejectedCount:0,validationStatus:"verified",startedAt:"2026-01-01T00:00:00Z",completedAt:"2026-01-01T00:00:01Z",diagnostics:[]}]}]},"2026-01-01T00:00:01Z");
  const laterStore=new SqliteScoutRunStore(database,descriptionsRoot,{...screening,profile:{candidate:"Later Candidate"},profileVersion:"profile-v2",profileArtifactId:"profile-artifact-v2",profileHash:"profile-hash-v2"});
  const laterRun=laterStore.startOrReuse(20,5,"2026-01-01T00:00:01.100Z").run,laterJob=laterStore.pendingJobs(1)[0]!;
  const laterPosition={...position,title:"Later mutable title",location:"Later location",canonicalUrl:"https://careers.example.test/jobs/screen-1-later",provenance:{...position.provenance,descriptionUrl:"https://careers.example.test/jobs/screen-1-later"}};
  laterStore.commitResult(laterJob,{companyId:laterJob.companyId,configurationVersionId:laterJob.configurationVersionId,positions:[laterPosition],sources:[{sourceKey:"official",status:"succeeded_with_results",positions:[laterPosition],attempts:[]}]} ,"2026-01-01T00:00:01.200Z");
  expect(laterRun.id).not.toBe(run.id);
  database.query(`INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,source_url,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('gig-later-only','Example Company','Later tracked role','identified','pending','Tracked','2026-01-01','good',?,'[]',0,0,1,0,'2026-01-01','2026-01-01')`).run(laterPosition.canonicalUrl);
  store.backfillPositions(run.id,20,"2026-01-01T00:00:01.300Z");
  let relevanceCalls=0,scoreCalls=0;
  const model:ScoutScreeningModel={async screenRelevance(){relevanceCalls++;return{value:{decision:"passes_relevance",reason:"The role explicitly leads a technology organization.",confidence:.98,evidence:["Technology leadership scope"],ambiguities:[]},metrics:{provider:"synthetic-provider",model:"synthetic-model",modelConfiguration:"temperature=0",inputTokens:10,outputTokens:5,latencyMs:20}};},async scoreCandidateMatch(){scoreCalls++;return{value:{score:8,scoreExplanation:"The candidate profile aligns with the role's leadership scope."},metrics:{provider:"synthetic-provider",model:"synthetic-model",modelConfiguration:"temperature=0",inputTokens:12,outputTokens:4,latencyMs:18}};}};
  const processor=new ScoutPositionProcessor(store,model,()=>"2026-01-01T00:00:02Z");
  for(let index=0;index<2;index++){const pending=store.pendingPositionJobs(10)[0];expect(pending).toBeDefined();await processor.process(pending!.id);}
  expect(database.query(`SELECT state,linked_gig_id linkedGigId FROM scout_position_states`).get()).toEqual({state:"processing",linkedGigId:null});
  const relevanceJob=store.pendingPositionJobs(10)[0]!;
  const boundRelevance=store.relevanceInput(relevanceJob.id);
  expect(boundRelevance).toMatchObject({title:position.title,location:position.location,officialUrl:position.canonicalUrl});
  database.query(`INSERT INTO scout_relevance_criteria(id,version,criteria,confidence_threshold,prompt_version,created_at) VALUES('later-criteria',2,'Later synthetic criteria',900,'later-prompt','2026-01-01T00:00:02Z')`).run();
  expect(store.relevanceInput(relevanceJob.id)).toMatchObject({descriptionHash:boundRelevance.descriptionHash,criteria:boundRelevance.criteria,criteriaVersion:1});
  await processor.process(relevanceJob.id);
  const scoreJob=store.pendingPositionJobs(10)[0]!;
  const boundScore=store.candidateMatchInput(scoreJob.id);
  database.query(`INSERT INTO scout_candidate_match_rubrics(id,version,rubric,prompt_version,created_at) VALUES('later-rubric',2,'Later synthetic rubric','later-match-prompt','2026-01-01T00:00:03Z')`).run();
  expect(store.candidateMatchInput(scoreJob.id)).toMatchObject({descriptionHash:boundScore.descriptionHash,rubric:boundScore.rubric,rubricVersion:1,profileVersion:"profile-v1",promptCacheKey:boundScore.promptCacheKey});
  store.appendRelevanceCriteria("Newest synthetic criteria",.9,"2026-01-01T00:00:04Z");
  expect(database.query(`SELECT status FROM scout_position_processing WHERE id=?`).get(scoreJob.id)).toEqual({status:"superseded"});
  expect(()=>store.completeCandidateMatch(scoreJob.id,{value:{score:1,scoreExplanation:"This stale result must not be applied."},metrics:{provider:"synthetic-provider",model:"synthetic-model",modelConfiguration:"temperature=0",inputTokens:1,outputTokens:1,latencyMs:1}},"2026-01-01T00:00:05Z")).toThrow("unavailable");
  expect(database.query(`SELECT state FROM scout_position_states`).get()).toEqual({state:"processing"});
  for(let index=0;index<2;index++)await processor.process(store.pendingPositionJobs(10)[0]!.id);
  expect({relevanceCalls,scoreCalls}).toEqual({relevanceCalls:2,scoreCalls:1});
  const persisted=database.query(`SELECT r.reason,m.score,m.score_explanation scoreExplanation,s.state FROM scout_relevance_evaluations r JOIN scout_candidate_match_evaluations m ON m.relevance_evaluation_id=r.id JOIN scout_position_states s ON s.position_id=r.position_id`).get() as Record<string,unknown>;
  expect(persisted).toEqual({reason:"The role explicitly leads a technology organization.",score:8,scoreExplanation:"The candidate profile aligns with the role's leadership scope.",state:"needs_user_review"});
  const workspace=store.workspace({state:"actionable",sort:"score",direction:"desc",offset:0,limit:20});
  expect(workspace.items[0]).toMatchObject({score:8,scoreExplanation:"The candidate profile aligns with the role's leadership scope."});
  expect(workspace.items[0]).not.toHaveProperty("reason");
  expect(store.get(run.id)?.status).toBe("completed");
});

test("Gig identity changes restart an incomplete bounded position backfill",()=>{
  const store=setup(),database=databases.at(-1)!;
  const run=store.startOrReuse(20,5,"2026-01-01T00:00:00Z").run;
  const sourceJob=store.pendingJobs(1)[0]!;
  store.commitResult(sourceJob,{companyId:sourceJob.companyId,configurationVersionId:sourceJob.configurationVersionId,positions:[],sources:[{sourceKey:"official",status:"succeeded_empty_verified",positions:[],attempts:[]}]} ,"2026-01-01T00:00:00.500Z");
  const runSourceId=(database.query(`SELECT rs.id FROM scout_run_sources rs JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE rc.run_id=?`).get(run.id) as {id:string}).id;
  const insert=database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,external_id,canonical_url,title,first_seen_at,last_seen_at) VALUES(?,'company-1','official','external_id',?,?,?,'Synthetic Role','2026-01-01','2026-01-01')`);
  insert.run("position-a","external-a","external-a","https://careers.example.test/a");
  insert.run("position-b","external-b","external-b","https://careers.example.test/b");
  insert.run("position-outside","external-outside","external-outside","https://careers.example.test/outside");
  database.query(`INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES(?,?,?,?,?,'{}','2026-01-01')`).run("observation-a",runSourceId,"position-a","Synthetic A","https://careers.example.test/a");
  database.query(`INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES(?,?,?,?,?,'{}','2026-01-01')`).run("observation-b",runSourceId,"position-b","Synthetic B","https://careers.example.test/b");
  expect(store.backfillPositions(run.id,1,"2026-01-01T00:00:00Z")).toEqual({created:1,complete:false});
  database.query(`INSERT INTO gigs(id,company,title,external_job_id,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('gig-a','Example Company','Synthetic Role','external-a','identified','pending','Tracked','2026-01-01','good','[]',0,0,1,0,'2026-01-01','2026-01-01')`).run();
  expect(store.backfillPositions(run.id,1,"2026-01-01T00:00:01Z")).toEqual({created:1,complete:false});
  const current=store.pendingPositionJobs(10).filter(job=>job.positionId==="position-a");
  expect(current).toHaveLength(1);
  expect(database.query(`SELECT 1 FROM scout_position_states WHERE position_id='position-outside'`).get()).toBeNull();
  expect(database.query(`SELECT source_run_id sourceRunId FROM scout_position_backfill`).get()).toEqual({sourceRunId:run.id});
});

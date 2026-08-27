import { afterEach, expect, test } from "bun:test";
import { openDatabase, migrateDatabase } from "../database";
import { SqliteScoutCompanyImportStore } from "../scout-company-import-store";
import { SqliteScoutRunStore } from "../scout-run-store";
import {DataStore} from "../store";
import {AuditReader} from "../audit";
import {GigFinderApplication} from "../../core/application";
import { importScoutCompany } from "../../core/scout/engine/company-import";
import type { CompanyScanResult } from "../../core/scout/engine";
import type { ScoutCompanyJob } from "../../core/scout/engine/runs";
import { ScoutPositionProcessor, type ScoutScreeningModel } from "../../core/scout/engine/screening";
import { ScoutPositionService } from "../../core/scout/engine/scout-position-service";
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

const successfulResult = (job: ScoutCompanyJob): CompanyScanResult => {
  const position = {
    sourceKey: "official",
    externalId: "job-1",
    canonicalUrl: "https://careers.example.test/jobs/1",
    title: "Synthetic Systems Gardener",
    location: "Remote",
    description: null,
    provenance: {
      sourceKey: "official",
      sourceUrl: "https://careers.example.test/jobs",
      description: "none" as const,
      descriptionUrl: "https://careers.example.test/jobs/1",
    },
  };
  return {
    companyId: job.companyId,
    configurationVersionId: job.configurationVersionId,
    positions: [position],
    sources: [
      {
        sourceKey: "official",
        status: "succeeded_with_results",
        positions: [position],
        attempts: [
          {
            sourceMethod: "json",
            stage: "listing",
            requestCount: 1,
            responseCount: 1,
            candidateCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            validationStatus: "verified",
            startedAt: "2026-08-27T12:00:00Z",
            completedAt: "2026-08-27T12:00:01Z",
            diagnostics: [],
          },
        ],
      },
    ],
  };
};

test("company result preparation remains nonterminal and is replay safe", () => {
  const store = setup();
  const database = databases.at(-1)!;
  const run = store.startOrReuse(20, 5, "2026-08-27T12:00:00Z").run;
  const job = store.pendingJobs(1)[0]!;
  const result = successfulResult(job);

  const prepared = store.prepareCompanyResult(
    job,
    result,
    "2026-08-27T12:00:01Z",
  );

  expect(prepared).toEqual({
    companyName: "Example Company",
    status: "succeeded",
    observedPositions: [
      {
        canonicalUrl: "https://careers.example.test/jobs/1",
        externalId: "job-1",
      },
    ],
  });
  expect(
    database
      .query("SELECT status FROM scout_run_companies WHERE id=?")
      .get(job.runCompanyId),
  ).toEqual({ status: "queued" });
  expect(store.get(run.id)?.status).toBe("queued");

  store.prepareCompanyResult(job, result, "2026-08-27T12:00:02Z");

  expect(
    database
      .query(
        `SELECT
          (SELECT count(*) FROM scout_source_attempts) attempts,
          (SELECT count(*) FROM scout_position_observations) observations,
          (SELECT count(*) FROM scout_position_processing) processing,
          (SELECT count(*) FROM scout_position_processing_outbox) outbox`,
      )
      .get(),
  ).toEqual({ attempts: 1, observations: 1, processing: 1, outbox: 1 });

  store.completeCompanyResult(job, prepared, "2026-08-27T12:00:03Z");

  expect(
    database
      .query("SELECT status FROM scout_run_companies WHERE id=?")
      .get(job.runCompanyId),
  ).toEqual({ status: "succeeded" });
  expect(store.get(run.id)?.status).toBe("completed");
});

test("Scout result persistence never mutates tracked Gig availability", () => {
  const store = setup();
  const database = databases.at(-1)!;
  const application = new GigFinderApplication(
    new DataStore(database),
    new AuditReader(database),
    {
      jobDescription: async () => "",
      interviewPrep: async () => [],
      jobDescriptionExists: async () => false,
      interviewPrepExists: async () => false,
      verify: async () => ({ ok: true, errors: [], unregistered: [] }),
    },
  );
  application.gigs.create(
    {
      actor: "Synthetic test",
      source: "test",
      summary: "Create tracked Gig",
      changeId: "create-gig-1",
      occurredAt: "2026-08-27T11:00:00Z",
    },
    {
      id: "gig-1",
      company: "Example Company",
      title: "Synthetic Systems Gardener",
      externalJobId: "job-1",
      artifactDirectory: null,
      stage: "identified",
      outcome: "pending",
      statusSummary: "Tracked",
      lastActivity: "2026-08-27",
      nextAction: null,
      fit: { rating: "good", summary: null },
      payRange: null,
      sourceUrl: "https://careers.example.test/jobs/1",
      tags: [],
    },
  );
  const before = database
    .query(
      `SELECT availability,availability_updated_at availabilityUpdatedAt,revision
       FROM gigs WHERE id='gig-1'`,
    )
    .get();
  const beforeCounts = database
    .query(
      `SELECT
        (SELECT count(*) FROM changes
         WHERE summary IN (
           'Reconciled tracked Gig availability',
           'Observed official position availability'
         )) changes,
        (SELECT count(*) FROM gig_history) history`,
    )
    .get();
  store.startOrReuse(20, 5, "2026-08-27T12:00:00Z");
  const job = store.pendingJobs(1)[0]!;
  const prepared = store.prepareCompanyResult(
    job,
    successfulResult(job),
    "2026-08-27T12:00:01Z",
  );

  expect(
    database
      .query(
        `SELECT availability,availability_updated_at availabilityUpdatedAt,revision
         FROM gigs WHERE id='gig-1'`,
      )
      .get(),
  ).toEqual(before);
  store.completeCompanyResult(job, prepared, "2026-08-27T12:00:02Z");
  expect(
    database
      .query(
        `SELECT availability,availability_updated_at availabilityUpdatedAt,revision
         FROM gigs WHERE id='gig-1'`,
      )
      .get(),
  ).toEqual(before);
  expect(
    database
      .query(
        `SELECT
          (SELECT count(*) FROM changes
           WHERE summary IN (
             'Reconciled tracked Gig availability',
             'Observed official position availability'
           )) changes,
          (SELECT count(*) FROM gig_history) history`,
      )
      .get(),
  ).toEqual(beforeCounts);
});
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
        locations: [{ label: "Remote USA", workArrangement: "remote" as const }],
        workArrangement: "remote" as const,
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
            filterDecisions: [{
              identity: "official\0role-1",
              titleMatched: true,
              locationMatched: true,
              normalizedTitle: "systems gardener",
              normalizedLocations: ["remote usa"],
              workArrangements: ["remote" as const],
            }],
          },
        ],
      },
    ],
  };
  result.sources[0]!.positions = result.positions as never[];
  prepareAndComplete(store,job, result, "2026-01-01T00:00:01Z");
  prepareAndComplete(store,job, result, "2026-01-01T00:00:02Z");
  const detail = store.get(run.id)!;
  expect(detail.status).toBe("completed");
  expect(detail.companies[0]?.sources[0]).toMatchObject({
    candidateCount: 1,
    acceptedCount: 1,
  });
  expect(detail.companies[0]?.sources[0]?.attempts).toHaveLength(2);
  const persistedDecision = databases.at(-1)!.query(
    `SELECT filter_decisions_json decisions FROM scout_source_attempts WHERE validation_status='verified'`,
  ).get() as { decisions: string };
  expect(JSON.parse(persistedDecision.decisions)).toEqual(result.sources[0]!.attempts[1]!.filterDecisions);
  const persistedObservation = databases.at(-1)!.query(
    `SELECT provenance_json provenance FROM scout_position_observations LIMIT 1`,
  ).get() as { provenance: string };
  expect(JSON.parse(persistedObservation.provenance)).toMatchObject({
    displayLocation: "Remote",
    locations: [{ label: "Remote USA", workArrangement: "remote" }],
    workArrangement: "remote",
  });
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
  expect(store.backfillPositions(run.id,20,"2026-01-01T00:00:04Z")).toMatchObject({sourceRunId:run.id,selection:{selected:1,complete:true}});
  expect(store.backfillPositions(run.id,20,"2026-01-01T00:00:04.500Z")).toMatchObject({sourceRunId:run.id,selection:{selected:1,complete:true}});
  const position=store.workspace({state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20}).items[0]!;
  expect(store.positionDetail(position.id)?.observations).toHaveLength(1);
  expect(store.workspace({text:"does not match",state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20}).counts).toEqual({actionable:0,processing:0,needs_user_review:0,irrelevant:0,deferred:0});
  new DataStore(databases.at(-1)!).change({actor:"Synthetic test",source:"test",summary:"Create exact Gig"},transaction=>transaction.gigs.create({id:"gig-exact",company:"Example Company",title:"Systems Gardener",externalJobId:"role-1",stage:"identified",outcome:"pending",statusSummary:"Tracked",lastActivity:"2026-01-01",nextActionDescription:null,nextActionDue:null,fitRating:"good",fitSummary:null,payCurrency:null,payMinimum:null,payMaximum:null,payPeriod:null,payNotes:null,sourceUrl:null,location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null,tagsJson:"[]",hasJobDescription:false,hasInterviewPrep:false,availability:"unknown",availabilityUpdatedAt:null}));
  expect(store.backfillPositions(run.id,20,"2026-01-01T00:00:05Z")).toMatchObject({sourceRunId:run.id,selection:{selected:1,complete:true}});
  store.reconcileGig(store.pendingPositionJobs(20)[0]!,"2026-01-01T00:00:06Z");
  expect(store.workspace({state:"actionable",sort:"last_seen",direction:"desc",offset:0,limit:20}).total).toBe(0);
  expect(databases.at(-1)!.query("SELECT state,linked_gig_id linkedGigId,revision FROM scout_position_states WHERE position_id=?").get(position.id)).toEqual({state:"promoted",linkedGigId:"gig-exact",revision:2});
});
test("backfill binds failed description recovery to a newly imported source configuration exactly once",()=>{
  const store=setup(),database=databases.at(-1)!;
  const run=store.startOrReuse(20,5,"2026-01-01T00:00:00Z").run,job=store.pendingJobs(1)[0]!;
  const position={sourceKey:"official",externalId:"role-transition",canonicalUrl:"https://careers.example.test/jobs/role-transition",title:"Synthetic Transition Lead",location:"Remote",description:null,provenance:{sourceKey:"official",sourceUrl:"https://careers.example.test/jobs",description:"none" as const,descriptionUrl:"https://careers.example.test/jobs/role-transition"}};
  prepareAndComplete(store,job,{companyId:job.companyId,configurationVersionId:job.configurationVersionId,positions:[position],sources:[{sourceKey:"official",status:"succeeded_with_results",positions:[position],attempts:[]}]},"2026-01-01T00:00:01Z");
  store.reconcileGig(store.pendingPositionJobs(1)[0]!,"2026-01-01T00:00:02Z");
  const failed=store.pendingPositionJobs(1)[0]!;
  store.failPositionProcessing(failed,"description_too_large","Synthetic historical failure","2026-01-01T00:00:03Z");
  const original=database.query(`SELECT id,input_identity inputIdentity,configuration_source_id configurationSourceId FROM scout_position_processing WHERE id=?`).get(failed.id) as {id:string;inputIdentity:string;configurationSourceId:string|null};
  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{id:"id",title:"title",url:"url"},detailDescription:{response:"json",request:{urlTemplate:"{source.origin}/details/{position.id}",method:"GET"},descriptionPath:"job.description",identity:{idPath:"job.id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-01-01T00:00:04Z"));
  store.backfillPositions(run.id,20,"2026-01-01T00:00:05Z");
  const rows=database.query(`SELECT id,input_identity inputIdentity,status,configuration_source_id configurationSourceId FROM scout_position_processing WHERE stage='acquire_description' ORDER BY created_at,id`).all() as Array<{id:string;inputIdentity:string;status:string;configurationSourceId:string|null}>;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({id:original.id,inputIdentity:original.inputIdentity,status:"superseded",configurationSourceId:null});
  expect(rows[1]).toMatchObject({status:"pending"});
  expect(rows[1]!.inputIdentity).not.toBe(original.inputIdentity);
  expect(rows[1]!.configurationSourceId).not.toBeNull();
  store.backfillPositions(run.id,20,"2026-01-01T00:00:06Z");
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE stage='acquire_description'`).get()).toEqual({count:2});
});
test("partial source outcomes roll up explicitly", () => {
  const store = setup();
  const run = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z").run;
  const job = store.pendingJobs(1)[0]!;
  prepareAndComplete(store,
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
  prepareAndComplete(store,job,{companyId:job.companyId,configurationVersionId:job.configurationVersionId,positions:[position],sources:[{sourceKey:"official",status:"succeeded_with_results",positions:[position],attempts:[{sourceMethod:"json",stage:"listing",requestCount:1,responseCount:1,candidateCount:1,acceptedCount:1,rejectedCount:0,validationStatus:"verified",startedAt:"2026-01-01T00:00:00Z",completedAt:"2026-01-01T00:00:01Z",diagnostics:[]}]}]},"2026-01-01T00:00:01Z");
  expect(database.query(`SELECT count(*) count FROM scout_position_descriptions`).get()).toEqual({count:1});
  const laterStore=new SqliteScoutRunStore(database,descriptionsRoot,{...screening,profile:{candidate:"Later Candidate"},profileVersion:"profile-v2",profileArtifactId:"profile-artifact-v2",profileHash:"profile-hash-v2"});
  const laterRun=laterStore.startOrReuse(20,5,"2026-01-01T00:00:01.100Z").run,laterJob=laterStore.pendingJobs(1)[0]!;
  const laterPosition={...position,title:"Later mutable title",location:"Later location",canonicalUrl:"https://careers.example.test/jobs/screen-1-later",provenance:{...position.provenance,descriptionUrl:"https://careers.example.test/jobs/screen-1-later"}};
  prepareAndComplete(laterStore,laterJob,{companyId:laterJob.companyId,configurationVersionId:laterJob.configurationVersionId,positions:[laterPosition],sources:[{sourceKey:"official",status:"succeeded_with_results",positions:[laterPosition],attempts:[]}]} ,"2026-01-01T00:00:01.200Z");
  expect(laterRun.id).not.toBe(run.id);
  database.query(`INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,source_url,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('gig-later-only','Example Company','Later tracked role','identified','pending','Tracked','2026-01-01','good',?,'[]',0,0,1,0,'2026-01-01','2026-01-01')`).run(laterPosition.canonicalUrl);
  database.query(`UPDATE scout_runs SET screening_cache_key=NULL,candidate_profile_json=NULL,candidate_profile_version=NULL,candidate_profile_artifact_id=NULL,candidate_profile_hash=NULL WHERE id=?`).run(run.id);
  const backfill=store.backfillPositions(run.id,20,"2026-01-01T00:00:01.300Z");
  expect(backfill).toMatchObject({sourceRunId:run.id,selection:{selected:1,complete:true},downstream:{pending:1}});
  expect(database.query(`SELECT run_type runType,source_run_id sourceRunId,screening_cache_key IS NOT NULL hasCache,candidate_profile_json profileJson FROM scout_runs WHERE id=?`).get(backfill.backfillRunId)).toEqual({runType:"legacy_backfill",sourceRunId:run.id,hasCache:1,profileJson:null});
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
  const promotionApplication=new GigFinderApplication(new DataStore(database),new AuditReader(database),{jobDescription:async()=>"",interviewPrep:async()=>[],jobDescriptionExists:async()=>false,interviewPrepExists:async()=>false,verify:async()=>({ok:true,errors:[],unregistered:[]})});
  const changedStore=new SqliteScoutRunStore(database,descriptionsRoot,{...screening,profile:{candidate:"Current Candidate"},profileVersion:"profile-v2",profileArtifactId:"profile-artifact-v2",profileHash:"profile-hash-v2"});
  const positions=new ScoutPositionService(changedStore,promotionApplication.gigs,promotionApplication.documents);
  expect(changedStore.refreshCandidateMatch(scoreJob.id,"2026-01-01T00:00:03.500Z")).toBeTrue();
  expect(database.query(`SELECT status FROM scout_position_processing WHERE id=?`).get(scoreJob.id)).toEqual({status:"superseded"});
  const currentScoreJob=changedStore.pendingPositionJobs(10)[0]!;
  expect(changedStore.candidateMatchInput(currentScoreJob.id)).toMatchObject({profileVersion:"profile-v2",profileHash:"profile-hash-v2",promptCacheKey:boundScore.promptCacheKey});
  await new ScoutPositionProcessor(changedStore,model,()=>"2026-01-01T00:00:04Z").process(currentScoreJob.id);
  expect({relevanceCalls,scoreCalls}).toEqual({relevanceCalls:1,scoreCalls:1});
  const completedDescription=database.query(`SELECT id FROM scout_position_processing WHERE stage='acquire_description' AND status='completed' LIMIT 1`).get() as {id:string};
  database.query(`UPDATE scout_position_processing SET status='failed',attempt_count=3,failure_code='description_too_large',failure_message='Synthetic prior failure',completed_at='2026-01-01T00:00:04Z' WHERE id=?`).run(completedDescription.id);
  database.query(`UPDATE scout_position_processing_outbox SET dispatch_status='dispatched',dispatched_at='2026-01-01T00:00:04Z' WHERE processing_id=?`).run(completedDescription.id);
  const recoveredAgain=changedStore.backfillPositions(run.id,20,"2026-01-01T00:00:05Z");
  expect(recoveredAgain.backfillRunId).toBe(backfill.backfillRunId);
  expect(database.query(`SELECT status,attempt_count attemptCount,failure_code failureCode FROM scout_position_processing WHERE id=?`).get(completedDescription.id)).toEqual({status:"pending",attemptCount:0,failureCode:null});
  expect(database.query(`SELECT dispatch_status dispatchStatus,dispatched_at dispatchedAt FROM scout_position_processing_outbox WHERE processing_id=?`).get(completedDescription.id)).toEqual({dispatchStatus:"pending",dispatchedAt:null});
  changedStore.completeDescription(completedDescription.id,{markdown:"Exact acquired detail Markdown.",sourceContentHash:"a".repeat(64),sourceUrl:"https://careers.example.test/jobs/screen-1/detail",retrievedAt:"2026-01-01T00:00:05.500Z",converterVersion:"detail-converter-v2",strategyVersion:"json-field-v1"},"2026-01-01T00:00:05.500Z");
  const acquiredDescription=database.query(`SELECT description_id descriptionId FROM scout_position_processing WHERE id=?`).get(completedDescription.id) as {descriptionId:string};
  database.query(`UPDATE scout_relevance_evaluations SET description_id=?`).run(acquiredDescription.descriptionId);
  expect(database.query(`SELECT count(*) relevanceCount FROM scout_relevance_evaluations`).get()).toEqual({relevanceCount:1});
  expect(database.query(`SELECT count(*) matchCount FROM scout_candidate_match_evaluations`).get()).toEqual({matchCount:1});
  const persisted=database.query(`SELECT r.reason,m.score,m.score_explanation scoreExplanation,s.state FROM scout_relevance_evaluations r JOIN scout_candidate_match_evaluations m ON m.relevance_evaluation_id=r.id JOIN scout_position_states s ON s.position_id=r.position_id`).get() as Record<string,unknown>;
  expect(persisted).toEqual({reason:"The role explicitly leads a technology organization.",score:8,scoreExplanation:"The candidate profile aligns with the role's leadership scope.",state:"needs_user_review"});
  const workspace=store.workspace({state:"actionable",sort:"score",direction:"desc",offset:0,limit:20});
  expect(workspace.items[0]).toMatchObject({score:8,scoreExplanation:"The candidate profile aligns with the role's leadership scope."});
  expect(workspace.items[0]).not.toHaveProperty("reason");
  expect(store.get(run.id)?.status).toBe("completed");
  const review=changedStore.reviewDetail(workspace.items[0]!.id)!;
  const identities={descriptionId:review.descriptionId!,relevanceEvaluationId:review.relevanceEvaluationId!,candidateMatchEvaluationId:review.candidateMatchEvaluationId!};
  const deferred=changedStore.decide({positionId:review.id,action:"defer",actor:"Reviewer",changeId:"change-defer",expectedStateRevision:review.stateRevision,...identities,reviewAt:"2026-01-02T00:00:00Z",note:"Review tomorrow."},"2026-01-01T00:00:07Z");
  expect(deferred).toMatchObject({state:"deferred",stateRevision:review.stateRevision+1});
  expect(()=>changedStore.decide({positionId:review.id,action:"irrelevant",actor:"Reviewer",changeId:"change-stale",expectedStateRevision:review.stateRevision,...identities},"2026-01-01T00:00:08Z")).toThrow("revised");
  const deferDecision=database.query(`SELECT id,actor,note FROM scout_position_decisions WHERE change_id='change-defer'`).get() as {id:string;actor:string;note:string};
  expect(deferDecision).toMatchObject({actor:"Reviewer",note:"Review tomorrow."});
  const reversed=changedStore.reverseDecision({positionId:review.id,decisionId:deferDecision.id,changeId:"change-reverse",actor:"Reviewer",expectedStateRevision:deferred.stateRevision},"2026-01-01T00:00:09Z");
  expect(reversed.state).toBe("needs_user_review");
  const reversedReview=changedStore.reviewDetail(review.id)!;
  expect(()=>changedStore.reverseDecision({positionId:review.id,decisionId:deferDecision.id,changeId:"change-reverse-again",actor:"Reviewer",expectedStateRevision:reversedReview.stateRevision},"2026-01-01T00:00:10Z")).toThrow();
  const deferredAgain=changedStore.decide({positionId:review.id,action:"defer",actor:"Reviewer",changeId:"change-defer-due",expectedStateRevision:reversedReview.stateRevision,...identities,reviewAt:"2026-01-01T00:00:10Z"},"2026-01-01T00:00:09Z");
  expect(changedStore.resurfaceDue("2026-01-01T00:00:11Z")).toBe(1);
  const resurfaced=changedStore.reviewDetail(review.id)!;
  expect(resurfaced).toMatchObject({state:"needs_user_review",stateRevision:deferredAgain.stateRevision+1});
  database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,canonical_url,title,first_seen_at,last_seen_at) VALUES('other-position','company-1','official','canonical_url','https://careers.example.test/other','https://careers.example.test/other','Other role','2026-01-01','2026-01-01')`).run();
  expect(()=>changedStore.appendPositionNote({positionId:"other-position",decisionId:deferDecision.id,actor:"Reviewer",body:"Wrong position"},"2026-01-01T00:00:12Z")).toThrow("does not belong");
  database.exec(`CREATE TRIGGER synthetic_promotion_failure BEFORE INSERT ON managed_documents BEGIN SELECT RAISE(ABORT,'Synthetic promotion failure'); END`);
  const failed=positions.decide(review.id,{action:"pursue",actor:"Reviewer",changeId:"change-pursue",expectedStateRevision:resurfaced.stateRevision,...identities});
  expect(failed).toMatchObject({state:"processing",promotionStatus:"failed",promotionFailureCode:"promotion_failed"});
  expect(database.query(`SELECT status,description_id descriptionId FROM scout_position_promotions WHERE position_id=?`).get(review.id)).toEqual({status:"failed",descriptionId:identities.descriptionId});
  expect(database.query(`SELECT entity_type entityType FROM creation_idempotency WHERE change_id='change-pursue:gig'`).get()).toEqual({entityType:"gig"});
  expect(database.query(`SELECT count(*) count FROM managed_documents`).get()).toEqual({count:0});
  const replayedFailure=positions.decide(review.id,{action:"pursue",actor:"Forged replay",changeId:"change-pursue",expectedStateRevision:0,descriptionId:"wrong-description",relevanceEvaluationId:"wrong-relevance",candidateMatchEvaluationId:"wrong-match"});
  expect(replayedFailure).toMatchObject({state:"processing",promotionStatus:"failed"});
  database.exec(`DROP TRIGGER synthetic_promotion_failure`);
  const promotionWork=changedStore.promotionWork(review.id)!;
  const mismatchedDocument=promotionApplication.documents.create({actor:"Reviewer",source:"automation",summary:"Synthetic partial promotion",changeId:"change-pursue:document",occurredAt:"2026-01-01T00:00:14Z"},{links:[{entityType:"gig",entityId:promotionWork.gigId}],documentType:"job_description",title:`${promotionWork.company} — ${promotionWork.title}`,mediaType:"text/markdown",sourceDescription:"wrong provenance",content:promotionWork.markdown,uploadProvenance:null}).document;
  expect(positions.retryPromotion(review.id)).toMatchObject({state:"processing",promotionStatus:"failed",promotionFailureMessage:"Reviewed Scout document replay does not match the persisted promotion."});
  database.query(`UPDATE managed_documents SET source_description=? WHERE id=?`).run(promotionWork.sourceDescription,mismatchedDocument.id);
  const promoted=positions.retryPromotion(review.id);
  expect(promoted).toBeNull();
  expect(positions.decide(review.id,{action:"pursue",actor:"Forged replay",changeId:"change-pursue",expectedStateRevision:0,descriptionId:"wrong-description",relevanceEvaluationId:"wrong-relevance",candidateMatchEvaluationId:"wrong-match"})).toBeNull();
  expect(database.query(`SELECT s.state,p.status FROM scout_position_states s JOIN scout_position_promotions p ON p.position_id=s.position_id WHERE s.position_id=?`).get(review.id)).toEqual({state:"promoted",status:"completed"});
  const promotedContent=database.query(`SELECT v.content,d.actor FROM managed_document_versions v JOIN scout_position_promotions p ON p.managed_document_id=v.document_id JOIN scout_position_decisions d ON d.id=p.decision_id WHERE p.position_id=?`).get(review.id) as {content:string;actor:string};
  expect(promotedContent).toEqual({content:review.descriptionMarkdown!,actor:"Reviewer"});
  const promotedProvenance=database.query(`SELECT d.source_description sourceDescription FROM managed_documents d JOIN scout_position_promotions p ON p.managed_document_id=d.id WHERE p.position_id=?`).get(review.id) as {sourceDescription:string};
  expect(JSON.parse(promotedProvenance.sourceDescription)).toMatchObject({scoutDescriptionId:identities.descriptionId,officialSourceUrl:"https://careers.example.test/jobs/screen-1/detail",retrievedAt:"2026-01-01T00:00:05.500Z",sourceKey:"official",configurationVersionId:expect.any(String),extractionStrategy:"json-field-v1",converterVersion:"detail-converter-v2"});
  expect(database.query(`SELECT count(*) count FROM gigs WHERE id=(SELECT gig_id FROM scout_position_promotions WHERE position_id=?)`).get(review.id)).toEqual({count:1});
  expect(database.query(`SELECT entity_type entityType FROM creation_idempotency WHERE change_id='change-pursue:gig'`).get()).toEqual({entityType:"gig"});
  expect(database.query(`SELECT count(*) count FROM changes WHERE id IN ('change-pursue:gig','change-pursue:document')`).get()).toEqual({count:2});
  database.exec(`DELETE FROM managed_document_links; DELETE FROM managed_document_versions; DELETE FROM scout_position_promotions; DELETE FROM managed_documents; UPDATE scout_position_states SET state='needs_user_review',linked_gig_id=NULL,deferred_until=NULL,current_decision_id=NULL WHERE position_id<>'other-position'; DELETE FROM scout_position_notes; DELETE FROM scout_position_decisions; DELETE FROM changes WHERE id LIKE 'change-%'; DELETE FROM gigs;`);
  database.query(`UPDATE scout_position_processing SET run_id=? WHERE stage='screen_relevance' AND status='completed'`).run(run.id);
  database.query(`DELETE FROM scout_position_processing_outbox WHERE processing_id IN (SELECT id FROM scout_position_processing WHERE stage='score_candidate_match')`).run();
  database.query(`DELETE FROM scout_position_processing WHERE stage='score_candidate_match'`).run();
  database.query(`DELETE FROM scout_candidate_match_evaluations`).run();
  database.query(`UPDATE scout_relevance_evaluations SET decision='fails_relevance',confidence=500`).run();
  database.query(`UPDATE scout_position_states SET state='processing'`).run();
  changedStore.backfillPositions(run.id,20,"2026-01-01T00:00:06Z");
  expect(changedStore.pendingPositionJobs(10)).toContainEqual(expect.objectContaining({stage:"score_candidate_match"}));
});

test("Gig identity changes restart an incomplete bounded position backfill",()=>{
  const store=setup(),database=databases.at(-1)!;
  const run=store.startOrReuse(20,5,"2026-01-01T00:00:00Z").run;
  const sourceJob=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,sourceJob,{companyId:sourceJob.companyId,configurationVersionId:sourceJob.configurationVersionId,positions:[],sources:[{sourceKey:"official",status:"succeeded_empty_verified",positions:[],attempts:[]}]} ,"2026-01-01T00:00:00.500Z");
  const runSourceId=(database.query(`SELECT rs.id FROM scout_run_sources rs JOIN scout_run_companies rc ON rc.id=rs.run_company_id WHERE rc.run_id=?`).get(run.id) as {id:string}).id;
  const insert=database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,external_id,canonical_url,title,first_seen_at,last_seen_at) VALUES(?,'company-1','official','external_id',?,?,?,'Synthetic Role','2026-01-01','2026-01-01')`);
  insert.run("position-a","external-a","external-a","https://careers.example.test/a");
  insert.run("position-b","external-b","external-b","https://careers.example.test/b");
  insert.run("position-outside","external-outside","external-outside","https://careers.example.test/outside");
  database.query(`INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES(?,?,?,?,?,'{}','2026-01-01')`).run("observation-a",runSourceId,"position-a","Synthetic A","https://careers.example.test/a");
  database.query(`INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES(?,?,?,?,?,'{}','2026-01-01')`).run("observation-b",runSourceId,"position-b","Synthetic B","https://careers.example.test/b");
  expect(store.backfillPositions(run.id,1,"2026-01-01T00:00:00Z")).toMatchObject({sourceRunId:run.id,selection:{selected:2,complete:false}});
  database.query(`INSERT INTO gigs(id,company,title,external_job_id,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('gig-a','Example Company','Synthetic Role','external-a','identified','pending','Tracked','2026-01-01','good','[]',0,0,1,0,'2026-01-01','2026-01-01')`).run();
  expect(store.backfillPositions(run.id,1,"2026-01-01T00:00:01Z")).toMatchObject({sourceRunId:run.id,selection:{selected:2,complete:false}});
  const current=store.pendingPositionJobs(10).filter(job=>job.positionId==="position-a");
  expect(current).toHaveLength(1);
  expect(database.query(`SELECT 1 FROM scout_position_states WHERE position_id='position-outside'`).get()).toBeNull();
  expect(database.query(`SELECT source_run_id sourceRunId FROM scout_position_backfill`).get()).toEqual({sourceRunId:run.id});
});
const prepareAndComplete = (
  store: SqliteScoutRunStore,
  job: Parameters<SqliteScoutRunStore["prepareCompanyResult"]>[0],
  result: Parameters<SqliteScoutRunStore["prepareCompanyResult"]>[1],
  now: string,
) =>
  store.completeCompanyResult(
    job,
    store.prepareCompanyResult(job, result, now),
    now,
  );

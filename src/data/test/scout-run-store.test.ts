import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
          detailDescription: {
            response: "json",
            request: { urlTemplate: "{source.origin}/initial-details/{position.id}", method: "GET" },
            descriptionPath: "job.description",
            identity: { idPath: "job.id" },
          },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(db),
  );
  return new SqliteScoutRunStore(db);
}

test("Scout run persistence never mutates managed-document tables directly",()=>{
  const source=readFileSync(new URL("../scout-run-store.ts",import.meta.url),"utf8");
  expect(source).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+`?managed_(?:documents|document_versions|document_links)`?/i);
  expect(source).not.toMatch(/\b(?:FROM|JOIN)\s+`?managed_(?:documents|document_versions|document_links)`?/i);
});

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

test("explicit position backfill preview validates and resolves exact current bindings",()=>{
  const store=setup(),database=databases.at(-1)!;
  store.startOrReuse(20,5,"2026-08-28T12:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const acceptedId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  const runSourceId=(database.query(`SELECT id FROM scout_run_sources LIMIT 1`).get() as {id:string}).id;
  const noObservationId=`spos_${"a".repeat(32)}`;
  const noConfigurationId=`spos_${"b".repeat(32)}`;
  database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,canonical_url,title,first_seen_at,last_seen_at) VALUES(?,'company-1','official','canonical_url',?,?,'No observation','2026-08-28','2026-08-28')`).run(noObservationId,"https://careers.example.test/no-observation","https://careers.example.test/no-observation");
  database.query(`INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,canonical_url,title,first_seen_at,last_seen_at) VALUES(?,'company-1','inactive-source','canonical_url',?,?,'No active configuration','2026-08-28','2026-08-28')`).run(noConfigurationId,"https://careers.example.test/no-configuration","https://careers.example.test/no-configuration");
  database.query(`INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES('observation-no-configuration',?,?, 'No active configuration',?,'{}','2026-08-28T12:00:02Z')`).run(runSourceId,noConfigurationId,"https://careers.example.test/no-configuration");

  expect(store.previewBackfill({positionIds:[acceptedId,acceptedId],reason:" Reprocess configured descriptions "})).toEqual({
    requested:1,
    accepted:[{positionId:acceptedId,company:"Example Company",title:"Synthetic Systems Gardener",state:"processing",linkedGigId:null}],
    rejected:[],
  });
  expect(store.previewBackfill({positionIds:[`spos_${"f".repeat(32)}`,noObservationId,noConfigurationId],reason:"Synthetic repair"})).toEqual({
    requested:3,
    accepted:[],
    rejected:[
      {positionId:noObservationId,code:"no_observation"},
      {positionId:noConfigurationId,code:"no_active_configuration"},
      {positionId:`spos_${"f".repeat(32)}`,code:"not_found"},
    ],
  });
  expect(()=>store.previewBackfill({positionIds:[],reason:"Synthetic repair"})).toThrow();
  expect(()=>store.previewBackfill({positionIds:["position-1"],reason:"Synthetic repair"})).toThrow();
  expect(store.previewBackfill({positionIds:Array.from({length:1001},()=>acceptedId),reason:"Synthetic repair"})).toMatchObject({requested:1,accepted:[{positionId:acceptedId}]});
  expect(()=>store.previewBackfill({positionIds:Array.from({length:1001},(_,index)=>`spos_${index.toString(16).padStart(32,"0")}`),reason:"Synthetic repair"})).toThrow();
  expect(()=>store.previewBackfill({positionIds:[acceptedId],reason:" "})).toThrow();
  expect(()=>store.previewBackfill({positionIds:[acceptedId],reason:"x".repeat(501)})).toThrow();
});

test("explicit position backfill preview rejects listing-only description acquisition",()=>{
  const store=setup(),database=databases.at(-1)!;
  store.startOrReuse(20,5,"2026-08-28T12:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{id:"id",title:"title",url:"url",description:"description"}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-28T12:00:02Z"));

  expect(store.previewBackfill({positionIds:[positionId],reason:"Reprocess configured descriptions"})).toMatchObject({
    requested:1,
    accepted:[],
    rejected:[{positionId,code:"description_acquisition_not_configured"}],
  });
});

test("explicit position backfill preview rejects JSON detail identities that require a missing external ID",()=>{
  const store=setup(),database=databases.at(-1)!;
  store.startOrReuse(20,5,"2026-08-28T12:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  database.query(`UPDATE scout_positions SET external_id=NULL WHERE id=?`).run(positionId);

  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{id:"id",title:"title",url:"url"},detailDescription:{response:"json",request:{urlTemplate:"{position.url}",method:"GET"},descriptionPath:"job.description",identity:{idPath:"job.id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-28T12:00:02Z"));

  expect(store.previewBackfill({positionIds:[positionId],reason:"Reprocess ID-verified JSON description"})).toMatchObject({
    requested:1,
    accepted:[],
    rejected:[{positionId,code:"description_identity_input_missing"}],
  });
});

test("explicit position backfill preview rejects DOM detail identities that require a missing external ID",()=>{
  const store=setup(),database=databases.at(-1)!;
  store.startOrReuse(20,5,"2026-08-28T12:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  database.query(`UPDATE scout_positions SET external_id=NULL WHERE id=?`).run(positionId);
  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"html",url:"https://careers.example.test/jobs",listingSelector:".job",titleField:{selector:".title"},urlField:{selector:"a"},listingSurfaceSelector:".jobs",detailDescription:{response:"html",urlTemplate:"{position.url}",extractor:{type:"dom",selector:".description",idSelector:"#job-id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-28T12:00:03Z"));

  expect(store.previewBackfill({positionIds:[positionId],reason:"Reprocess ID-verified DOM description"})).toMatchObject({
    requested:1,
    accepted:[],
    rejected:[{positionId,code:"description_identity_input_missing"}],
  });
});

test("explicit position backfill preview rejects a JSON ID identity with an empty external ID",()=>{
  const store=setup(),database=databases.at(-1)!;
  store.startOrReuse(20,5,"2026-08-28T12:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  database.query(`UPDATE scout_positions SET external_id='' WHERE id=?`).run(positionId);
  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{id:"id",title:"title",url:"url"},detailDescription:{response:"json",request:{urlTemplate:"{position.url}",method:"GET"},descriptionPath:"job.description",identity:{idPath:"job.id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-28T12:00:02Z"));

  expect(store.previewBackfill({positionIds:[positionId],reason:"Reject empty JSON identity"})).toMatchObject({
    requested:1,
    accepted:[],
    rejected:[{positionId,code:"description_identity_input_missing"}],
  });
});

test("explicit position backfill preview rejects a DOM ID identity with a whitespace external ID",()=>{
  const store=setup(),database=databases.at(-1)!;
  store.startOrReuse(20,5,"2026-08-28T12:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  database.query(`UPDATE scout_positions SET external_id=' \t ' WHERE id=?`).run(positionId);
  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"html",url:"https://careers.example.test/jobs",listingSelector:".job",titleField:{selector:".title"},urlField:{selector:"a"},listingSurfaceSelector:".jobs",detailDescription:{response:"html",urlTemplate:"{position.url}",extractor:{type:"dom",selector:".description",idSelector:"#job-id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-28T12:00:02Z"));

  expect(store.previewBackfill({positionIds:[positionId],reason:"Reject whitespace DOM identity"})).toMatchObject({
    requested:1,
    accepted:[],
    rejected:[{positionId,code:"description_identity_input_missing"}],
  });
});

test("explicit position backfill starts atomically and reuses its durable fingerprint",()=>{
  setup();
  const database=databases.at(-1)!;
  const screening={profile:{summary:"Synthetic current profile"},profileVersion:"profile-v3",profileArtifactId:"profile-artifact-v3",profileHash:"profile-hash-v3",model:"synthetic-model",provider:"synthetic-provider",modelConfiguration:"structured-v1"};
  const store=new SqliteScoutRunStore(database,undefined,screening);
  const sourceRun=store.startOrReuse(20,5,"2026-08-28T12:00:00Z").run;
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T12:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  const observationId=(database.query(`SELECT id FROM scout_position_observations WHERE position_id=?`).get(positionId) as {id:string}).id;
  const configurationSourceId=(database.query(`SELECT id FROM scout_company_configuration_sources WHERE active=1 LIMIT 1`).get() as {id:string}).id;
  const completedProcessingId=(database.query(`SELECT id FROM scout_position_processing WHERE position_id=? AND stage='reconcile_gig'`).get(positionId) as {id:string}).id;
  database.query(`UPDATE scout_position_processing SET status='completed',attempt_count=1,updated_at='2026-08-28T12:00:01Z',completed_at='2026-08-28T12:00:01Z' WHERE id=?`).run(completedProcessingId);
  database.query(`UPDATE scout_position_processing_outbox SET dispatch_status='dispatched',dispatched_at='2026-08-28T12:00:01Z' WHERE processing_id=?`).run(completedProcessingId);

  expect(()=>store.startBackfill({positionIds:[positionId,`spos_${"f".repeat(32)}`],reason:"Reject partial execution"},"2026-08-28T12:00:02Z")).toThrow();
  expect(database.query(`SELECT count(*) count FROM scout_runs WHERE run_type='position_backfill'`).get()).toEqual({count:0});

  const first=store.startBackfill({positionIds:[positionId,positionId],reason:" Reprocess configured descriptions "},"2026-08-28T12:00:03Z");
  const second=store.startBackfill({positionIds:[positionId],reason:"Reprocess configured descriptions"},"2026-08-28T12:00:04Z");
  expect(second).toEqual(first);
  expect(first).toEqual({
    runId:expect.stringMatching(/^srun_/),
    reason:"Reprocess configured descriptions",
    status:"running",
    completedAt:null,
    selection:{requested:1,accepted:1,rejected:0},
    stages:{
      reconcile_gig:{pending:1,completed:0,failed:0,superseded:0},
      acquire_description:{pending:0,completed:0,failed:0,superseded:0},
      screen_relevance:{pending:0,completed:0,failed:0,superseded:0},
      score_candidate_match:{pending:0,completed:0,failed:0,superseded:0},
    },
    positionOutcomes:{pending:1},
    positions:[{positionId,company:"Example Company",template:"custom",descriptionOutcome:null,outcome:"pending",failureCode:null}],
    gigDocuments:{pending:0,updated:0,unchanged:0,failed:0},
  });
  expect(database.query(`SELECT run_type runType,operator_reason reason,length(request_fingerprint) fingerprintLength,candidate_profile_version profileVersion,candidate_profile_json profileJson,screening_cache_key IS NOT NULL hasCache,screening_model model,screening_provider provider,screening_model_configuration modelConfiguration FROM scout_runs WHERE id=?`).get(first.runId)).toEqual({runType:"position_backfill",reason:"Reprocess configured descriptions",fingerprintLength:64,profileVersion:"profile-v3",profileJson:JSON.stringify(screening.profile),hasCache:1,model:screening.model,provider:screening.provider,modelConfiguration:screening.modelConfiguration});
  expect(database.query(`SELECT position_id positionId,observation_id observationId,configuration_source_id configurationSourceId,linked_gig_id linkedGigId,requested_at requestedAt FROM scout_position_backfill_items WHERE run_id=?`).get(first.runId)).toEqual({positionId,observationId,configurationSourceId,linkedGigId:null,requestedAt:"2026-08-28T12:00:03Z"});
  const newProcessing=database.query(`SELECT id,input_identity inputIdentity,status FROM scout_position_processing WHERE run_id=?`).get(first.runId) as {id:string;inputIdentity:string;status:string};
  expect(newProcessing).toMatchObject({inputIdentity:expect.stringMatching(/^[0-9a-f]{64}$/),status:"pending"});
  expect(database.query(`SELECT queue_job_id queueJobId,dispatch_status dispatchStatus FROM scout_position_processing_outbox WHERE processing_id=?`).get(newProcessing.id)).toEqual({queueJobId:`position:${newProcessing.id}`,dispatchStatus:"pending"});
  expect(database.query(`SELECT count(*) count FROM scout_runs WHERE run_type='position_backfill'`).get()).toEqual({count:1});
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE position_id=? AND stage='reconcile_gig'`).get(positionId)).toEqual({count:2});
  expect(database.query(`SELECT status,completed_at completedAt FROM scout_position_processing WHERE id=?`).get(completedProcessingId)).toEqual({status:"completed",completedAt:"2026-08-28T12:00:01Z"});
  expect(store.backfillStatus(first.runId)).toEqual(first);
  expect(store.backfillStatus(sourceRun.id)).toBeNull();
  database.query(`INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,source_url,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('backfill-gig','Example Company','Synthetic Systems Gardener','identified','pending','Synthetic','2026-08-28','good','https://careers.example.test/jobs/1','[]',1,0,1,0,'2026-08-28','2026-08-28')`).run();
  store.reconcileGig(newProcessing.id,"2026-08-28T12:00:04.500Z");
  expect(store.backfillStatus(first.runId)?.gigDocuments).toEqual({pending:0,updated:0,unchanged:0,failed:0});
  const distinctReason=store.startBackfill({positionIds:[positionId],reason:"Reprocess for a separate defect"},"2026-08-28T12:00:05Z");
  expect(distinctReason.runId).not.toBe(first.runId);
  expect(database.query(`SELECT linked_gig_id linkedGigId FROM scout_position_backfill_items WHERE run_id=?`).get(distinctReason.runId)).toEqual({linkedGigId:"backfill-gig"});
  expect(distinctReason.gigDocuments).toEqual({pending:0,updated:0,unchanged:0,failed:0});
  expect(()=>store.backfillPositions(distinctReason.runId,20,"2026-08-28T12:00:06Z")).toThrow("source run not found");
  expect(database.query(`SELECT count(*) count FROM scout_runs WHERE run_type='legacy_backfill' AND source_run_id=?`).get(distinctReason.runId)).toEqual({count:0});
  expect(database.query(`SELECT count(*) count FROM scout_runs WHERE run_type='position_backfill'`).get()).toEqual({count:2});
});

test("real processor durably records promoted document outcomes and reconciles a crash after update",async()=>{
  setup();
  const database=databases.at(-1)!;
  const descriptionsRoot=mkdtempSync(path.join(process.cwd(),"tmp","scout-promoted-description-"));
  temporaryDirectories.push(descriptionsRoot);
  const screening={profile:{summary:"Synthetic candidate"},profileVersion:"profile-v1",profileArtifactId:"profile-artifact-v1",profileHash:"profile-hash-v1",model:"model-v1",provider:"provider-v1",modelConfiguration:"configuration-v1"};
  const store=new SqliteScoutRunStore(database,descriptionsRoot,screening);
  store.startOrReuse(20,5,"2026-08-29T01:00:00Z");
  const companyJob=store.pendingJobs(1)[0]!;
  const position={sourceKey:"official",externalId:"promoted-143",canonicalUrl:"https://careers.example.test/jobs/promoted-143",title:"Director of Synthetic Platforms",location:"Remote",description:"Original official description.",provenance:{sourceKey:"official",sourceUrl:"https://careers.example.test/jobs",description:"listing" as const,descriptionUrl:"https://careers.example.test/jobs/promoted-143"}};
  prepareAndComplete(store,companyJob,{companyId:companyJob.companyId,configurationVersionId:companyJob.configurationVersionId,positions:[position],sources:[{sourceKey:"official",status:"succeeded_with_results",positions:[position],attempts:[]}]} ,"2026-08-29T01:00:01Z");
  const model:ScoutScreeningModel={
    async screenRelevance(){return{value:{decision:"passes_relevance",reason:"Synthetic relevant role",confidence:.99,evidence:["Technology leadership"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}};},
    async scoreCandidateMatch(){return{value:{score:9,scoreExplanation:"Synthetic candidate match"},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}};},
  };
  const initialProcessor=new ScoutPositionProcessor(store,model,()=>"2026-08-29T01:00:02Z");
  while(store.pendingPositionJobs(20)[0])await initialProcessor.process(store.pendingPositionJobs(20)[0]!.id);
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  const review=store.reviewDetail(positionId)!;
  const application=new GigFinderApplication(new DataStore(database),new AuditReader(database),{jobDescription:async()=>"",interviewPrep:async()=>[],jobDescriptionExists:async()=>false,interviewPrepExists:async()=>false,verify:async()=>({ok:true,errors:[],unregistered:[]})});
  const positions=new ScoutPositionService(store,application.gigs,application.documents);
  positions.decide(positionId,{action:"pursue",actor:"Reviewer",changeId:"promote-description-143",expectedStateRevision:review.stateRevision,descriptionId:review.descriptionId!,relevanceEvaluationId:review.relevanceEvaluationId!,candidateMatchEvaluationId:review.candidateMatchEvaluationId!});
  const promotion=database.query(`SELECT gig_id gigId,managed_document_id managedDocumentId FROM scout_position_promotions WHERE position_id=? AND status='completed'`).get(positionId) as {gigId:string;managedDocumentId:string};
  expect(application.documents.versions(promotion.managedDocumentId)).toHaveLength(1);

  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{id:"id",title:"title",url:"url"},detailDescription:{response:"json",request:{urlTemplate:"{source.origin}/details/{position.id}",method:"GET"},descriptionPath:"job.description",identity:{idPath:"job.id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-29T01:00:03Z"));
  const corrected={markdown:"Corrected official description.",sourceContentHash:"a".repeat(64),extractedContentHash:"b".repeat(64),sourceUrl:"https://careers.example.test/details/promoted-143",retrievedAt:"2026-08-29T01:00:04Z",converterVersion:"scout-description-v2",strategyVersion:"json-field-v1"};
  const first=store.startBackfill({positionIds:[positionId],reason:"Correct the promoted description"},"2026-08-29T01:00:03Z");
  const firstReconcile=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='reconcile_gig'`).get(first.runId) as {id:string}).id;
  store.reconcileGig(firstReconcile,"2026-08-29T01:00:03.500Z");
  const firstAcquire=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='acquire_description'`).get(first.runId) as {id:string}).id;
  const prepared=store.prepareDescriptionCompletion(firstAcquire,corrected,"2026-08-29T01:00:04Z");
  expect(prepared.promotedDocument).toEqual({
    processingId:firstAcquire,
    positionId,
    gigId:promotion.gigId,
    managedDocumentId:promotion.managedDocumentId,
    markdown:corrected.markdown,
    sourceDescription:"Gig Scout official posting retrieved from official configuration 2.",
    sourceProvenance:{officialUrl:corrected.sourceUrl,retrievedAt:corrected.retrievedAt,sourceContentHash:corrected.sourceContentHash,extractedContentHash:corrected.extractedContentHash,sourceKey:"official",configurationVersion:2,extractionStrategy:corrected.strategyVersion,converterVersion:corrected.converterVersion},
    documentChangeId:expect.stringMatching(/^change_[0-9a-f]{32}$/),
  });
  expect(database.query(`SELECT status,description_id descriptionId,document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(firstAcquire)).toEqual({status:"pending",descriptionId:prepared.descriptionId,documentProjectionStatus:"pending"});
  const replayedPreparation=store.prepareDescriptionCompletion(firstAcquire,corrected,"2026-08-29T01:00:05Z");
  expect(replayedPreparation).toEqual(prepared);
  await new ScoutPositionProcessor(store,model,()=>"2026-08-29T01:00:05Z",undefined,application.documents).process(firstAcquire);
  expect(application.documents.versions(promotion.managedDocumentId)).toMatchObject([{version:2,sourceDescription:prepared.promotedDocument!.sourceDescription,sourceProvenance:prepared.promotedDocument!.sourceProvenance},{version:1,sourceDescription:null,sourceProvenance:null}]);
  expect(database.query(`SELECT document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(firstAcquire)).toEqual({documentProjectionStatus:"updated"});
  expect(store.backfillStatus(first.runId)?.gigDocuments).toEqual({pending:0,updated:1,unchanged:0,failed:0});
  database.query(`UPDATE scout_position_processing SET document_projection_status='unchanged' WHERE id=?`).run(firstAcquire);
  expect(store.backfillStatus(first.runId)?.gigDocuments).toEqual({pending:0,updated:0,unchanged:1,failed:0});
  database.query(`UPDATE scout_position_processing SET document_projection_status='updated' WHERE id=?`).run(firstAcquire);

  const unchangedRun=store.startBackfill({positionIds:[positionId],reason:"Verify unchanged promoted description"},"2026-08-29T01:00:06Z");
  const unchangedReconcile=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='reconcile_gig'`).get(unchangedRun.runId) as {id:string}).id;
  store.reconcileGig(unchangedReconcile,"2026-08-29T01:00:06.500Z");
  const unchangedAcquire=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='acquire_description'`).get(unchangedRun.runId) as {id:string}).id;
  const unchanged={...corrected,sourceContentHash:"c".repeat(64),extractedContentHash:"d".repeat(64),retrievedAt:"2026-08-29T01:00:07Z"};
  const unchangedPrepared=store.prepareDescriptionCompletion(unchangedAcquire,unchanged,"2026-08-29T01:00:07Z");
  expect(unchangedPrepared.descriptionId).toBe(prepared.descriptionId);
  expect(unchangedPrepared.promotedDocument?.sourceProvenance).toMatchObject({
    retrievedAt:unchanged.retrievedAt,
    sourceContentHash:unchanged.sourceContentHash,
    extractedContentHash:unchanged.extractedContentHash,
  });
  expect(database.query(`SELECT description_id descriptionId,source_url sourceUrl,retrieved_at retrievedAt,source_content_hash sourceContentHash,extracted_content_hash extractedContentHash,source_key sourceKey,configuration_version configurationVersion,extraction_strategy extractionStrategy,converter_version converterVersion FROM scout_description_acquisitions WHERE processing_id=?`).get(unchangedAcquire)).toEqual({descriptionId:prepared.descriptionId,sourceUrl:unchanged.sourceUrl,retrievedAt:unchanged.retrievedAt,sourceContentHash:unchanged.sourceContentHash,extractedContentHash:unchanged.extractedContentHash,sourceKey:"official",configurationVersion:2,extractionStrategy:unchanged.strategyVersion,converterVersion:unchanged.converterVersion});
  expect(database.query(`SELECT count(*) count FROM scout_description_acquisitions WHERE description_id=?`).get(prepared.descriptionId)).toEqual({count:2});
  await new ScoutPositionProcessor(store,model,()=>"2026-08-29T01:00:07Z",undefined,application.documents).process(unchangedAcquire);
  expect(application.documents.versions(promotion.managedDocumentId)).toHaveLength(2);
  expect(database.query(`SELECT document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(unchangedAcquire)).toEqual({documentProjectionStatus:"unchanged"});
  expect(store.backfillStatus(unchangedRun.runId)?.gigDocuments).toEqual({pending:0,updated:0,unchanged:1,failed:0});

  const conflicted={...corrected,markdown:"Final corrected official description.",sourceContentHash:"c".repeat(64),extractedContentHash:"d".repeat(64),retrievedAt:"2026-08-29T01:00:08Z"};
  const conflictRun=store.startBackfill({positionIds:[positionId],reason:"Retry a promoted document conflict"},"2026-08-29T01:00:08Z");
  const conflictReconcile=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='reconcile_gig'`).get(conflictRun.runId) as {id:string}).id;
  store.reconcileGig(conflictReconcile,"2026-08-29T01:00:08.500Z");
  const conflictAcquire=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='acquire_description'`).get(conflictRun.runId) as {id:string}).id;
  const conflictPrepared=store.prepareDescriptionCompletion(conflictAcquire,conflicted,"2026-08-29T01:00:09Z");
  application.documents.update({actor:"Reviewer",source:"user_request",summary:"Concurrent edit",changeId:"concurrent-promoted-edit",occurredAt:"2026-08-29T01:00:09Z"},{documentId:promotion.managedDocumentId,expectedVersion:2,content:"Concurrent user edit.",changeSummary:"Concurrent edit"});
  expect(()=>application.documents.update({actor:"Gig Scout",source:"automation",summary:"Refresh promoted Gig job description",changeId:conflictPrepared.promotedDocument!.documentChangeId,occurredAt:"2026-08-29T01:00:09Z"},{documentId:promotion.managedDocumentId,expectedVersion:2,content:conflicted.markdown,changeSummary:"Refresh from current official Scout posting",sourceDescription:conflictPrepared.promotedDocument!.sourceDescription,sourceProvenance:conflictPrepared.promotedDocument!.sourceProvenance})).toThrow("expected version 2 but is at version 3");
  store.failDescriptionProjection(conflictAcquire,"document_projection_failed","Synthetic document revision conflict.","2026-08-29T01:00:09Z");
  expect(database.query(`SELECT status,description_id descriptionId,failure_code failureCode,document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(conflictAcquire)).toEqual({status:"pending",descriptionId:conflictPrepared.descriptionId,failureCode:"document_projection_failed",documentProjectionStatus:"failed"});
  expect(store.backfillStatus(conflictRun.runId)?.gigDocuments).toEqual({pending:0,updated:0,unchanged:0,failed:1});
  const retried=store.prepareDescriptionCompletion(conflictAcquire,conflicted,"2026-08-29T01:00:10Z");
  expect(retried).toMatchObject({descriptionId:conflictPrepared.descriptionId,promotedDocument:{documentChangeId:conflictPrepared.promotedDocument!.documentChangeId}});
  expect(database.query(`SELECT document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(conflictAcquire)).toEqual({documentProjectionStatus:"pending"});
  const final=application.documents.update({actor:"Gig Scout",source:"automation",summary:"Refresh promoted Gig job description",changeId:retried.promotedDocument!.documentChangeId,occurredAt:"2026-08-29T01:00:10Z"},{documentId:promotion.managedDocumentId,expectedVersion:3,content:conflicted.markdown,changeSummary:"Refresh from current official Scout posting",sourceDescription:retried.promotedDocument!.sourceDescription,sourceProvenance:retried.promotedDocument!.sourceProvenance});
  store.completeDescription(conflictAcquire,retried.descriptionId,final.changed?"updated":"unchanged","2026-08-29T01:00:10Z");
  expect(database.query(`SELECT document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(conflictAcquire)).toEqual({documentProjectionStatus:"updated"});
  expect(store.backfillStatus(conflictRun.runId)?.gigDocuments).toEqual({pending:0,updated:1,unchanged:0,failed:0});
  expect(database.query(`SELECT count(*) count FROM gigs WHERE id=?`).get(promotion.gigId)).toEqual({count:1});
  expect(database.query(`SELECT count(*) count FROM managed_documents WHERE id=?`).get(promotion.managedDocumentId)).toEqual({count:1});
  expect(application.documents.versions(promotion.managedDocumentId).filter(version=>version.changeId===retried.promotedDocument!.documentChangeId)).toHaveLength(1);

  const afterCrash={...corrected,markdown:"Crash-safe corrected official description.",sourceContentHash:"e".repeat(64),extractedContentHash:"f".repeat(64),retrievedAt:"2026-08-29T01:00:11Z"};
  const crashRun=store.startBackfill({positionIds:[positionId],reason:"Replay after managed document update"},"2026-08-29T01:00:11Z");
  const crashReconcile=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='reconcile_gig'`).get(crashRun.runId) as {id:string}).id;
  store.reconcileGig(crashReconcile,"2026-08-29T01:00:11.500Z");
  const crashAcquire=(database.query(`SELECT id FROM scout_position_processing WHERE run_id=? AND stage='acquire_description'`).get(crashRun.runId) as {id:string}).id;
  const crashPrepared=store.prepareDescriptionCompletion(crashAcquire,afterCrash,"2026-08-29T01:00:12Z");
  const beforeCrash=application.documents.get(promotion.managedDocumentId)!;
  application.documents.update({actor:"Gig Scout",source:"automation",summary:"Refresh promoted Gig job description",changeId:crashPrepared.promotedDocument!.documentChangeId,occurredAt:"2026-08-29T01:00:12Z"},{documentId:promotion.managedDocumentId,expectedVersion:beforeCrash.currentVersion,content:afterCrash.markdown,changeSummary:"Refresh from current official Scout posting",sourceDescription:crashPrepared.promotedDocument!.sourceDescription,sourceProvenance:crashPrepared.promotedDocument!.sourceProvenance});
  const afterScoutUpdate=application.documents.get(promotion.managedDocumentId)!;
  application.documents.update({actor:"Reviewer",source:"user_request",summary:"Edit job description after Scout refresh",changeId:"user-edit-after-scout-refresh",occurredAt:"2026-08-29T01:00:12.500Z"},{documentId:promotion.managedDocumentId,expectedVersion:afterScoutUpdate.currentVersion,content:"Newer user-authored description.",changeSummary:"Preserve a newer user edit"});
  const userVersion=application.documents.get(promotion.managedDocumentId)!;

  await new ScoutPositionProcessor(store,model,()=>"2026-08-29T01:00:13Z",undefined,application.documents).process(crashAcquire);

  expect(database.query(`SELECT status,document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id=?`).get(crashAcquire)).toEqual({status:"completed",documentProjectionStatus:"updated"});
  expect(store.backfillStatus(crashRun.runId)?.gigDocuments).toEqual({pending:0,updated:1,unchanged:0,failed:0});
  expect(application.documents.versions(promotion.managedDocumentId).filter(version=>version.changeId===crashPrepared.promotedDocument!.documentChangeId)).toHaveLength(1);
  expect(application.documents.get(promotion.managedDocumentId)).toMatchObject({currentVersion:userVersion.currentVersion,content:"Newer user-authored description."});
});

test("position backfill reruns the complete pipeline",async()=>{
  setup();
  const database=databases.at(-1)!;
  const descriptionsRoot=mkdtempSync(path.join(process.cwd(),"tmp","scout-position-backfill-pipeline-"));
  temporaryDirectories.push(descriptionsRoot);
  const screening={profile:{summary:"Synthetic candidate"},profileVersion:"profile-v1",profileArtifactId:"profile-artifact-v1",profileHash:"profile-hash-v1",model:"model-v1",provider:"provider-v1",modelConfiguration:"configuration-v1"};
  const store=new SqliteScoutRunStore(database,descriptionsRoot,screening);
  store.startOrReuse(20,5,"2026-08-28T14:00:00Z");
  const companyJob=store.pendingJobs(1)[0]!;
  const positions=[
    {sourceKey:"official",externalId:"pipeline-1",canonicalUrl:"https://careers.example.test/jobs/pipeline-1",title:"Director of Synthetic Platforms",location:"Remote",description:"Historical platform leadership description.",provenance:{sourceKey:"official",sourceUrl:"https://careers.example.test/jobs",description:"listing" as const,descriptionUrl:"https://careers.example.test/jobs/pipeline-1"}},
    {sourceKey:"official",externalId:"pipeline-2",canonicalUrl:"https://careers.example.test/jobs/pipeline-2",title:"Director of Synthetic Infrastructure",location:"Remote",description:"Historical infrastructure leadership description.",provenance:{sourceKey:"official",sourceUrl:"https://careers.example.test/jobs",description:"listing" as const,descriptionUrl:"https://careers.example.test/jobs/pipeline-2"}},
  ];
  prepareAndComplete(store,companyJob,{companyId:companyJob.companyId,configurationVersionId:companyJob.configurationVersionId,positions,sources:[{sourceKey:"official",status:"succeeded_with_results",positions,attempts:[]}]} ,"2026-08-28T14:00:01Z");
  const model:ScoutScreeningModel={
    async screenRelevance(){return{value:{decision:"passes_relevance",reason:"Synthetic relevant role",confidence:.99,evidence:["Technology leadership"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}};},
    async scoreCandidateMatch(){return{value:{score:8,scoreExplanation:"Synthetic candidate match"},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}};},
  };
  const processor=new ScoutPositionProcessor(store,model,()=>"2026-08-28T14:00:02Z");
  while(store.pendingPositionJobs(20)[0])await processor.process(store.pendingPositionJobs(20)[0]!.id);
  const positionIds=(database.query(`SELECT id FROM scout_positions ORDER BY id`).all() as Array<{id:string}>).map(row=>row.id);
  const historical=database.query(`SELECT id,position_id positionId,stage,input_identity inputIdentity,status FROM scout_position_processing ORDER BY position_id,stage`).all() as Array<{id:string;positionId:string;stage:string;inputIdentity:string;status:string}>;
  expect(historical).toHaveLength(8);
  expect(historical.every(row=>row.status==="completed")).toBeTrue();

  database.query(`INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,source_url,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('pipeline-gig-a','Example Company','Previously linked infrastructure role','identified','pending','Synthetic','2026-08-28','good','https://careers.example.test/jobs/previous-link','[]',1,0,1,0,'2026-08-28','2026-08-28')`).run();
  database.query(`INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,source_url,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('pipeline-gig-b','Example Company','Newly discovered infrastructure role','identified','pending','Synthetic','2026-08-28','good',?,'[]',1,0,1,0,'2026-08-28','2026-08-28')`).run(positions[1]!.canonicalUrl);
  database.query(`UPDATE scout_position_states SET state='promoted',linked_gig_id='pipeline-gig-a' WHERE position_id=?`).run(positionIds[1]!);
  importScoutCompany({id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{id:"id",title:"title",url:"url"},detailDescription:{response:"json",request:{urlTemplate:"{source.origin}/details/{position.id}",method:"GET"},descriptionPath:"job.description",identity:{idPath:"job.id"}}}]},new SqliteScoutCompanyImportStore(database),undefined,new Date("2026-08-28T14:00:03Z"));

  const backfill=store.startBackfill({positionIds,reason:"Rerun the complete processing pipeline"},"2026-08-28T14:00:04Z");
  const reconcileJobs=store.pendingPositionJobs(20).filter(job=>job.stage==="reconcile_gig"&&positionIds.includes(job.positionId));
  expect(reconcileJobs).toHaveLength(2);
  for(const job of reconcileJobs)store.reconcileGig(job.id,"2026-08-28T14:00:05Z");
  const acquireJobs=store.pendingPositionJobs(20).filter(job=>job.stage==="acquire_description"&&positionIds.includes(job.positionId));

  expect(acquireJobs).toHaveLength(2);
  expect(acquireJobs.every(job=>store.descriptionInput(job.id).existingDescriptionId===null)).toBeTrue();
  expect(acquireJobs.every(job=>store.descriptionInput(job.id).detailPlan?.request.url.includes("/details/pipeline-")===true)).toBeTrue();
  const historicalDescriptionId=(database.query(`SELECT id FROM scout_position_descriptions WHERE position_id=? ORDER BY created_at,id LIMIT 1`).get(acquireJobs[0]!.positionId) as {id:string}).id;
  expect(()=>store.completeDescription(acquireJobs[0]!.id,{markdown:"",sourceContentHash:"",sourceUrl:store.descriptionInput(acquireJobs[0]!.id).officialUrl,retrievedAt:"2026-08-28T14:00:05.500Z",converterVersion:"historical-converter",reusedDescriptionId:historicalDescriptionId},"2026-08-28T14:00:05.500Z")).toThrow("authoritative refetch");
  expect(database.query(`SELECT linked_gig_id linkedGigId FROM scout_position_backfill_items WHERE run_id=? AND position_id=?`).get(backfill.runId,positionIds[1]!)).toEqual({linkedGigId:"pipeline-gig-a"});
  expect(database.query(`SELECT state,linked_gig_id linkedGigId FROM scout_position_states WHERE position_id=?`).get(positionIds[1]!)).toEqual({state:"promoted",linkedGigId:"pipeline-gig-a"});
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE run_id=?`).get(backfill.runId)).toEqual({count:4});
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE status='completed' AND id IN (${historical.map(()=>"?").join(",")})`).get(...historical.map(row=>row.id))).toEqual({count:8});

  for(const job of acquireJobs)store.completeDescription(job.id,{markdown:`Authoritative backfill description for ${job.positionId}.`,sourceContentHash:"a".repeat(64),extractedContentHash:"1".repeat(64),sourceUrl:store.descriptionInput(job.id).officialUrl,retrievedAt:"2026-08-28T14:00:06Z",converterVersion:"backfill-converter-v1",strategyVersion:"json-field-v1"},"2026-08-28T14:00:06Z");
  const relevanceJobs=store.pendingPositionJobs(20).filter(job=>job.stage==="screen_relevance"&&positionIds.includes(job.positionId));
  expect(relevanceJobs).toHaveLength(2);
  for(const job of relevanceJobs)store.completeRelevance(job.id,{value:{decision:"passes_relevance",reason:"Authoritative description passes",confidence:.99,evidence:["Technology leadership"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},false,"2026-08-28T14:00:07Z");
  const candidateJobs=store.pendingPositionJobs(20).filter(job=>job.stage==="score_candidate_match"&&positionIds.includes(job.positionId));
  expect(candidateJobs).toHaveLength(2);
  for(const job of candidateJobs)store.completeCandidateMatch(job.id,{value:{score:9,scoreExplanation:"Authoritative candidate match"},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},"2026-08-28T14:00:08Z");
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE run_id=?`).get(backfill.runId)).toEqual({count:8});
  expect(database.query(`SELECT state,linked_gig_id linkedGigId FROM scout_position_states WHERE position_id=?`).get(positionIds[1]!)).toEqual({state:"promoted",linkedGigId:"pipeline-gig-a"});
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE status='completed' AND id IN (${historical.map(()=>"?").join(",")})`).get(...historical.map(row=>row.id))).toEqual({count:8});
  expect(store.backfillStatus(backfill.runId)).toMatchObject({
    status:"completed",
    completedAt:"2026-08-28T14:00:08Z",
    positionOutcomes:{needs_user_review:1,promoted:1},
    positions:expect.arrayContaining([
      {positionId:positionIds[0],company:"Example Company",template:"custom",descriptionOutcome:"corrected",outcome:"needs_user_review",failureCode:null},
      {positionId:positionIds[1],company:"Example Company",template:"custom",descriptionOutcome:"corrected",outcome:"promoted",failureCode:null},
    ]),
  });
  expect(database.query(`SELECT status,completed_at completedAt FROM scout_runs WHERE id=?`).get(backfill.runId)).toEqual({status:"completed",completedAt:"2026-08-28T14:00:08Z"});
  expect(store.startBackfill({positionIds,reason:"Rerun the complete processing pipeline"},"2026-08-28T14:00:08.500Z").runId).toBe(backfill.runId);
  expect(database.query(`SELECT count(*) count FROM scout_position_processing WHERE run_id=?`).get(backfill.runId)).toEqual({count:8});

  const secondBackfill=store.startBackfill({positionIds,reason:"Rerun the same immutable inputs separately"},"2026-08-28T14:00:09Z");
  expect(secondBackfill.runId).not.toBe(backfill.runId);
  const secondReconcile=store.pendingPositionJobs(20).filter(job=>job.stage==="reconcile_gig"&&positionIds.includes(job.positionId));
  expect(secondReconcile).toHaveLength(2);
  for(const job of secondReconcile)store.reconcileGig(job.id,"2026-08-28T14:00:10Z");
  const secondAcquire=store.pendingPositionJobs(20).filter(job=>job.stage==="acquire_description"&&positionIds.includes(job.positionId));
  expect(secondAcquire).toHaveLength(2);
  for(const job of secondAcquire)store.completeDescription(job.id,{markdown:`Authoritative backfill description for ${job.positionId}.`,sourceContentHash:"a".repeat(64),extractedContentHash:"2".repeat(64),sourceUrl:store.descriptionInput(job.id).officialUrl,retrievedAt:"2026-08-28T14:00:11Z",converterVersion:"backfill-converter-v1",strategyVersion:"json-field-v1"},"2026-08-28T14:00:11Z");
  const secondRelevance=store.pendingPositionJobs(20).filter(job=>job.stage==="screen_relevance"&&positionIds.includes(job.positionId));
  expect(secondRelevance).toHaveLength(2);
  expect(secondRelevance.map(job=>job.id).some(id=>relevanceJobs.map(job=>job.id).includes(id))).toBeFalse();

  const correctedPositionId=positionIds[0]!;
  database.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES('agent-irrelevant-change','2026-08-28T14:00:11Z','Gig Scout','automation','Synthetic agent irrelevance','committed')`).run();
  database.query(`INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,reason,relevance_evaluation_id,expected_state_revision,resulting_state_revision,created_at) VALUES('agent-irrelevant-decision','agent-irrelevant-change',?,'irrelevant','agent','Gig Scout','Historical agent decision',(SELECT id FROM scout_relevance_evaluations WHERE position_id=? ORDER BY created_at DESC,id DESC LIMIT 1),2,3,'2026-08-28T14:00:11Z')`).run(correctedPositionId,correctedPositionId);
  database.query(`UPDATE scout_position_states SET state='irrelevant',current_decision_id='agent-irrelevant-decision',revision=3 WHERE position_id=?`).run(correctedPositionId);
  const projectedBeforeCorrection=database.query(`SELECT d.id descriptionId,m.id matchId FROM scout_candidate_match_evaluations m JOIN scout_relevance_evaluations r ON r.id=m.relevance_evaluation_id JOIN scout_position_descriptions d ON d.id=r.description_id WHERE m.position_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(correctedPositionId);
  expect(database.query(`SELECT state,revision,current_decision_id currentDecisionId FROM scout_position_states WHERE position_id=?`).get(correctedPositionId)).toEqual({state:"irrelevant",revision:3,currentDecisionId:"agent-irrelevant-decision"});
  expect(database.query(`SELECT d.id descriptionId,m.id matchId FROM scout_candidate_match_evaluations m JOIN scout_relevance_evaluations r ON r.id=m.relevance_evaluation_id JOIN scout_position_descriptions d ON d.id=r.description_id WHERE m.position_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(correctedPositionId)).toEqual(projectedBeforeCorrection);

  for(const job of secondRelevance)store.completeRelevance(job.id,{value:{decision:"fails_relevance",reason:"Still definitively irrelevant",confidence:.99,evidence:["Non-target scope"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},true,"2026-08-28T14:00:12Z");
  const stillIrrelevant=database.query(`SELECT s.state,s.current_decision_id currentDecisionId,d.origin FROM scout_position_states s JOIN scout_position_decisions d ON d.id=s.current_decision_id WHERE s.position_id=?`).get(correctedPositionId) as {state:string;currentDecisionId:string;origin:string};
  expect(stillIrrelevant).toMatchObject({state:"irrelevant",origin:"agent"});
  expect(stillIrrelevant.currentDecisionId).not.toBe("agent-irrelevant-decision");
  expect(database.query(`SELECT decision.description_id descriptionId,decision.relevance_evaluation_id relevanceEvaluationId,decision.reason,evaluation.description_id evaluationDescriptionId FROM scout_position_decisions decision JOIN scout_relevance_evaluations evaluation ON evaluation.id=decision.relevance_evaluation_id WHERE decision.id=?`).get(stillIrrelevant.currentDecisionId)).toEqual({
    descriptionId:(database.query(`SELECT description_id descriptionId FROM scout_position_processing WHERE id=?`).get(secondRelevance.find(job=>job.positionId===correctedPositionId)!.id) as {descriptionId:string}).descriptionId,
    relevanceEvaluationId:(database.query(`SELECT id FROM scout_relevance_evaluations WHERE input_identity=(SELECT input_identity FROM scout_position_processing WHERE id=?)`).get(secondRelevance.find(job=>job.positionId===correctedPositionId)!.id) as {id:string}).id,
    reason:"Still definitively irrelevant",
    evaluationDescriptionId:(database.query(`SELECT description_id descriptionId FROM scout_position_processing WHERE id=?`).get(secondRelevance.find(job=>job.positionId===correctedPositionId)!.id) as {descriptionId:string}).descriptionId,
  });

  const correction=store.startBackfill({positionIds:[correctedPositionId],reason:"Correct the prior agent irrelevance"},"2026-08-28T14:00:13Z");
  const correctionReconcile=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="reconcile_gig")!;
  store.reconcileGig(correctionReconcile.id,"2026-08-28T14:00:14Z");
  const correctionAcquire=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="acquire_description")!;
  store.completeDescription(correctionAcquire.id,{markdown:"Corrected authoritative description.",sourceContentHash:"b".repeat(64),extractedContentHash:"3".repeat(64),sourceUrl:store.descriptionInput(correctionAcquire.id).officialUrl,retrievedAt:"2026-08-28T14:00:15Z",converterVersion:"backfill-converter-v1",strategyVersion:"json-field-v1"},"2026-08-28T14:00:15Z");
  const correctionRelevance=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="screen_relevance")!;
  store.completeRelevance(correctionRelevance.id,{value:{decision:"passes_relevance",reason:"Correction passes relevance",confidence:.99,evidence:["Target scope"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},false,"2026-08-28T14:00:16Z");
  const correctionCandidate=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="score_candidate_match")!;
  store.completeCandidateMatch(correctionCandidate.id,{value:{score:10,scoreExplanation:"Corrected candidate match"},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},"2026-08-28T14:00:17Z");
  expect(correction.runId).not.toBe(secondBackfill.runId);
  expect(database.query(`SELECT state,current_decision_id currentDecisionId FROM scout_position_states WHERE position_id=?`).get(correctedPositionId)).toEqual({state:"needs_user_review",currentDecisionId:null});

  const failedRun=store.startBackfill({positionIds:[correctedPositionId],reason:"Preserve the successful projection on failure"},"2026-08-28T14:00:18Z");
  const failedReconcile=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="reconcile_gig")!;
  store.reconcileGig(failedReconcile.id,"2026-08-28T14:00:19Z");
  const failedAcquire=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="acquire_description")!;
  store.completeDescription(failedAcquire.id,{markdown:"A newly stored description whose evaluation fails.",sourceContentHash:"c".repeat(64),extractedContentHash:"4".repeat(64),sourceUrl:store.descriptionInput(failedAcquire.id).officialUrl,retrievedAt:"2026-08-28T14:00:20Z",converterVersion:"backfill-converter-v1",strategyVersion:"json-field-v1"},"2026-08-28T14:00:20Z");
  const failedRelevance=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="screen_relevance")!;
  const successfulProjection=database.query(`SELECT d.id descriptionId,r.id relevanceId,m.id matchId FROM scout_candidate_match_evaluations m JOIN scout_relevance_evaluations r ON r.id=m.relevance_evaluation_id JOIN scout_position_descriptions d ON d.id=r.description_id WHERE m.position_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(correctedPositionId);
  const successfulState=database.query(`SELECT state,revision,current_decision_id currentDecisionId FROM scout_position_states WHERE position_id=?`).get(correctedPositionId);
  store.failPositionProcessing(failedRelevance.id,"synthetic_failure","Synthetic relevance failure","2026-08-28T14:00:21Z");
  expect(failedRun.runId).not.toBe(correction.runId);
  expect(database.query(`SELECT status FROM scout_position_processing WHERE id=?`).get(failedRelevance.id)).toEqual({status:"failed"});
  expect(database.query(`SELECT d.id descriptionId,r.id relevanceId,m.id matchId FROM scout_candidate_match_evaluations m JOIN scout_relevance_evaluations r ON r.id=m.relevance_evaluation_id JOIN scout_position_descriptions d ON d.id=r.description_id WHERE m.position_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(correctedPositionId)).toEqual(successfulProjection);
  expect(database.query(`SELECT state,revision,current_decision_id currentDecisionId FROM scout_position_states WHERE position_id=?`).get(correctedPositionId)).toEqual(successfulState);
  expect(store.backfillStatus(failedRun.runId)).toMatchObject({status:"failed",completedAt:"2026-08-28T14:00:21Z",positionOutcomes:{failed:1},positions:[expect.objectContaining({positionId:correctedPositionId,company:"Example Company",template:"custom",descriptionOutcome:"corrected",outcome:"failed",failureCode:"synthetic_failure"})]});

  database.query(`INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,source_url,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('pipeline-gig-c','Example Company','Discovered user-owned role','identified','pending','Synthetic','2026-08-28','good',?,'[]',1,0,1,0,'2026-08-28','2026-08-28')`).run(positions[0]!.canonicalUrl);
  const successfulIds=successfulProjection as {descriptionId:string;relevanceId:string;matchId:string};
  const beforeUserIrrelevant=database.query(`SELECT revision FROM scout_position_states WHERE position_id=?`).get(correctedPositionId) as {revision:number};
  database.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES('user-irrelevant-change','2026-08-28T14:00:22Z','Reviewer','web','Synthetic user irrelevance','committed')`).run();
  database.query(`INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,description_id,relevance_evaluation_id,candidate_match_evaluation_id,expected_state_revision,resulting_state_revision,created_at) VALUES('user-irrelevant-decision','user-irrelevant-change',?,'irrelevant','user','Reviewer',?,?,?,?,?,'2026-08-28T14:00:22Z')`).run(correctedPositionId,successfulIds.descriptionId,successfulIds.relevanceId,successfulIds.matchId,beforeUserIrrelevant.revision,beforeUserIrrelevant.revision+1);
  database.query(`UPDATE scout_position_states SET state='irrelevant',linked_gig_id=NULL,deferred_until=NULL,current_decision_id='user-irrelevant-decision',revision=revision+1,updated_at='2026-08-28T14:00:22Z' WHERE position_id=?`).run(correctedPositionId);
  const workflowProjection=(positionId:string)=>database.query(`SELECT state,revision,linked_gig_id linkedGigId,deferred_until deferredUntil,current_decision_id currentDecisionId,updated_at updatedAt FROM scout_position_states WHERE position_id=?`).get(positionId);
  const userIrrelevantProjection=workflowProjection(correctedPositionId);
  store.startBackfill({positionIds:[correctedPositionId],reason:"Preserve a user-owned irrelevant decision"},"2026-08-28T14:00:23Z");
  const userIrrelevantReconcile=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="reconcile_gig")!;
  store.reconcileGig(userIrrelevantReconcile.id,"2026-08-28T14:00:24Z");
  expect(workflowProjection(correctedPositionId)).toEqual(userIrrelevantProjection);
  const userIrrelevantAcquire=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="acquire_description")!;
  store.completeDescription(userIrrelevantAcquire.id,{markdown:"User-irrelevant authoritative history.",sourceContentHash:"d".repeat(64),extractedContentHash:"5".repeat(64),sourceUrl:store.descriptionInput(userIrrelevantAcquire.id).officialUrl,retrievedAt:"2026-08-28T14:00:25Z",converterVersion:"backfill-converter-v1",strategyVersion:"json-field-v1"},"2026-08-28T14:00:25Z");
  const userIrrelevantRelevance=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="screen_relevance")!;
  store.completeRelevance(userIrrelevantRelevance.id,{value:{decision:"fails_relevance",reason:"History remains irrelevant",confidence:.99,evidence:["Non-target scope"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},true,"2026-08-28T14:00:26Z");
  expect(workflowProjection(correctedPositionId)).toEqual(userIrrelevantProjection);
  expect(database.query(`SELECT x.status,EXISTS(SELECT 1 FROM scout_relevance_evaluations r WHERE r.input_identity=x.input_identity) evaluationPersisted FROM scout_position_processing x WHERE x.id=?`).get(userIrrelevantRelevance.id)).toEqual({status:"completed",evaluationPersisted:1});

  const beforeUserDeferred=database.query(`SELECT revision FROM scout_position_states WHERE position_id=?`).get(correctedPositionId) as {revision:number};
  database.query(`INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES('user-deferred-change','2026-08-28T14:00:27Z','Reviewer','web','Synthetic user defer','committed')`).run();
  database.query(`INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,description_id,relevance_evaluation_id,candidate_match_evaluation_id,expected_state_revision,resulting_state_revision,review_at,created_at) VALUES('user-deferred-decision','user-deferred-change',?,'defer','user','Reviewer',?,?,?,?,?,'2026-09-01T12:00:00Z','2026-08-28T14:00:27Z')`).run(correctedPositionId,successfulIds.descriptionId,successfulIds.relevanceId,successfulIds.matchId,beforeUserDeferred.revision,beforeUserDeferred.revision+1);
  database.query(`UPDATE scout_position_states SET state='deferred',linked_gig_id=NULL,deferred_until='2026-09-01T12:00:00Z',current_decision_id='user-deferred-decision',revision=revision+1,updated_at='2026-08-28T14:00:27Z' WHERE position_id=?`).run(correctedPositionId);
  const userDeferredProjection=workflowProjection(correctedPositionId);
  store.startBackfill({positionIds:[correctedPositionId],reason:"Preserve a user-owned deferred decision"},"2026-08-28T14:00:28Z");
  const userDeferredReconcile=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="reconcile_gig")!;
  store.reconcileGig(userDeferredReconcile.id,"2026-08-28T14:00:29Z");
  expect(workflowProjection(correctedPositionId)).toEqual(userDeferredProjection);
  const userDeferredAcquire=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="acquire_description")!;
  store.completeDescription(userDeferredAcquire.id,{markdown:"User-deferred authoritative history.",sourceContentHash:"e".repeat(64),extractedContentHash:"6".repeat(64),sourceUrl:store.descriptionInput(userDeferredAcquire.id).officialUrl,retrievedAt:"2026-08-28T14:00:30Z",converterVersion:"backfill-converter-v1",strategyVersion:"json-field-v1"},"2026-08-28T14:00:30Z");
  const userDeferredRelevance=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="screen_relevance")!;
  store.completeRelevance(userDeferredRelevance.id,{value:{decision:"passes_relevance",reason:"History passes relevance",confidence:.99,evidence:["Target scope"],ambiguities:[]},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},false,"2026-08-28T14:00:31Z");
  expect(workflowProjection(correctedPositionId)).toEqual(userDeferredProjection);
  const userDeferredCandidate=store.pendingPositionJobs(20).find(job=>job.positionId===correctedPositionId&&job.stage==="score_candidate_match")!;
  store.completeCandidateMatch(userDeferredCandidate.id,{value:{score:7,scoreExplanation:"Deferred history score"},metrics:{provider:screening.provider,model:screening.model,modelConfiguration:screening.modelConfiguration,inputTokens:1,outputTokens:1,latencyMs:1}},"2026-08-28T14:00:32Z");
  expect(workflowProjection(correctedPositionId)).toEqual(userDeferredProjection);
  expect(database.query(`SELECT x.status,EXISTS(SELECT 1 FROM scout_candidate_match_evaluations m WHERE m.input_identity=x.input_identity) evaluationPersisted FROM scout_position_processing x WHERE x.id=?`).get(userDeferredCandidate.id)).toEqual({status:"completed",evaluationPersisted:1});
});

test("explicit position backfill keeps its screening snapshot across restart and configuration change",async()=>{
  setup();
  const database=databases.at(-1)!;
  const descriptionsRoot=mkdtempSync(path.join(process.cwd(),"tmp","scout-position-backfill-snapshot-"));
  temporaryDirectories.push(descriptionsRoot);
  const original={profile:{summary:"Original candidate"},profileVersion:"profile-original",profileArtifactId:"profile-artifact-original",profileHash:"profile-hash-original",model:"model-original",provider:"provider-original",modelConfiguration:"configuration-original"};
  const changed={profile:{summary:"Changed candidate"},profileVersion:"profile-changed",profileArtifactId:"profile-artifact-changed",profileHash:"profile-hash-changed",model:"model-changed",provider:"provider-changed",modelConfiguration:"configuration-changed"};
  const store=new SqliteScoutRunStore(database,descriptionsRoot,original);
  store.startOrReuse(20,5,"2026-08-28T13:00:00Z");
  const job=store.pendingJobs(1)[0]!;
  prepareAndComplete(store,job,successfulResult(job),"2026-08-28T13:00:01Z");
  const positionId=(database.query(`SELECT id FROM scout_positions LIMIT 1`).get() as {id:string}).id;
  const backfill=store.startBackfill({positionIds:[positionId],reason:"Verify durable screening snapshot"},"2026-08-28T13:00:02Z");
  const reconcile=store.pendingPositionJobs(10).find(value=>value.stage==="reconcile_gig"&&value.positionId===positionId)!;
  const restarted=new SqliteScoutRunStore(database,descriptionsRoot,changed);
  restarted.reconcileGig(reconcile.id,"2026-08-28T13:00:03Z");
  const acquire=restarted.pendingPositionJobs(10).find(value=>value.stage==="acquire_description")!;
  const markdown="Durable original-model description.";
  restarted.completeDescription(acquire.id,{markdown,sourceContentHash:"a".repeat(64),extractedContentHash:"7".repeat(64),sourceUrl:"https://careers.example.test/jobs/1",retrievedAt:"2026-08-28T13:00:04Z",converterVersion:"synthetic-v1",strategyVersion:"json-field-v1"},"2026-08-28T13:00:04Z");
  const relevance=restarted.pendingPositionJobs(10).find(value=>value.stage==="screen_relevance")!;
  const persisted=database.query(`SELECT screening_model model,screening_provider provider,screening_model_configuration modelConfiguration,screening_cache_key cacheKey,candidate_profile_hash profileHash FROM scout_runs WHERE id=?`).get(backfill.runId) as {model:string;provider:string;modelConfiguration:string;cacheKey:string;profileHash:string};
  expect(persisted).toEqual({model:original.model,provider:original.provider,modelConfiguration:original.modelConfiguration,cacheKey:expect.any(String),profileHash:original.profileHash});
  const descriptionHash=createHash("sha256").update(markdown).digest("hex");
  const semanticRelevanceIdentity=createHash("sha256").update(JSON.stringify({positionId,title:"Synthetic Systems Gardener",location:"Remote",officialUrl:"https://careers.example.test/jobs/1",descriptionHash,criteriaVersion:1,promptVersion:"scout-relevance-v1",model:original.model,provider:original.provider,modelConfiguration:original.modelConfiguration})).digest("hex");
  const expectedRelevanceIdentity=createHash("sha256").update(JSON.stringify({runId:backfill.runId,inputIdentity:semanticRelevanceIdentity})).digest("hex");
  expect(relevance.inputIdentity).toBe(expectedRelevanceIdentity);
  const relevanceResult={value:{decision:"passes_relevance" as const,reason:"Synthetic pass",confidence:.99,evidence:["Synthetic evidence"],ambiguities:[]},metrics:{provider:original.provider,model:original.model,modelConfiguration:original.modelConfiguration,inputTokens:10,outputTokens:5,latencyMs:1}};
  expect(()=>restarted.completeRelevance(relevance.id,{...relevanceResult,metrics:{...relevanceResult.metrics,model:changed.model}},false,"2026-08-28T13:00:05Z")).toThrow("screening snapshot");
  const selections:Array<{provider:string;model:string;modelConfiguration:string}>=[];
  const currentModel:ScoutScreeningModel={async screenRelevance(){throw new Error("changed relevance model must not run");},async scoreCandidateMatch(){throw new Error("changed scoring model must not run");}};
  const selectedModel:ScoutScreeningModel={async screenRelevance(){return relevanceResult;},async scoreCandidateMatch(){return{value:{score:8,scoreExplanation:"Synthetic match"},metrics:{provider:original.provider,model:original.model,modelConfiguration:original.modelConfiguration,inputTokens:12,outputTokens:4,latencyMs:1}};}};
  const selector=(identity:{provider:string;model:string;modelConfiguration:string})=>{selections.push(identity);return selectedModel;};
  await new ScoutPositionProcessor(restarted,currentModel,()=>"2026-08-28T13:00:05Z",selector).process(relevance.id);
  const candidate=restarted.pendingPositionJobs(10).find(value=>value.stage==="score_candidate_match")!;
  const relevanceEvaluationId=(database.query(`SELECT id FROM scout_relevance_evaluations WHERE input_identity=?`).get(expectedRelevanceIdentity) as {id:string}).id;
  const semanticCandidateIdentity=createHash("sha256").update(JSON.stringify({relevanceEvaluationId,profileHash:original.profileHash,rubricVersion:1,promptVersion:"scout-candidate-match-v1",model:original.model,provider:original.provider,modelConfiguration:original.modelConfiguration})).digest("hex");
  const expectedCandidateIdentity=createHash("sha256").update(JSON.stringify({runId:backfill.runId,inputIdentity:semanticCandidateIdentity})).digest("hex");
  expect(candidate.inputIdentity).toBe(expectedCandidateIdentity);
  expect(restarted.candidateMatchInput(candidate.id)).toMatchObject({profile:original.profile,profileVersion:original.profileVersion,profileHash:original.profileHash,promptCacheKey:persisted.cacheKey});
  const candidateResult={value:{score:8,scoreExplanation:"Synthetic match"},metrics:{provider:original.provider,model:original.model,modelConfiguration:original.modelConfiguration,inputTokens:12,outputTokens:4,latencyMs:1}};
  expect(()=>restarted.completeCandidateMatch(candidate.id,{...candidateResult,metrics:{...candidateResult.metrics,provider:changed.provider}},"2026-08-28T13:00:06Z")).toThrow("screening snapshot");
  await new ScoutPositionProcessor(restarted,currentModel,()=>"2026-08-28T13:00:06Z",selector).process(candidate.id);
  expect(selections).toEqual([
    {provider:original.provider,model:original.model,modelConfiguration:original.modelConfiguration},
    {provider:original.provider,model:original.model,modelConfiguration:original.modelConfiguration},
  ]);
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

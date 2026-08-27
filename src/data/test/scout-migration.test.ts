import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateDatabase } from "../database";

const applyStatements = async (database: Database, migrationUrl: URL) => {
  const sql = await Bun.file(migrationUrl).text();
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
};

const columnNames = (database: Database, table: string) =>
  (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name);
const tableNames = (database: Database) =>
  (database.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(table => table.name);

test("0025 keeps the deployed Scout source constraint on JSON and HTML methods", async () => {
  const database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys=ON");

  await applyStatements(
    database,
    new URL("../migrations/0024_gig_scout.sql", import.meta.url),
  );
  await applyStatements(
    database,
    new URL("../migrations/0025_scout_reconciliation.sql", import.meta.url),
  );

  database
    .query(
      "INSERT INTO scout_companies(id,name,created_at,updated_at) VALUES('company','Synthetic Company','2026-01-01','2026-01-01')",
    )
    .run();
  database
    .query(
      "INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES('config','company',1,'fingerprint','2026-01-01')",
    )
    .run();

  expect(() =>
    database
      .query(
        "INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json) VALUES('source','config','official','json','{}')",
      )
      .run(),
  ).not.toThrow();

  expect(() =>
    database
      .query(
        "INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json) VALUES('legacy','config','legacy','platform','{}')",
      )
      .run(),
  ).toThrow();

  database.close();
});

test("0026 adds a neutral run-owned search profile to upgraded databases", async () => {
  const database = new Database(":memory:");
  await applyStatements(
    database,
    new URL("../migrations/0024_gig_scout.sql", import.meta.url),
  );
  await applyStatements(
    database,
    new URL("../migrations/0025_scout_reconciliation.sql", import.meta.url),
  );
  await applyStatements(
    database,
    new URL("../migrations/0026_scout_run_search_profile.sql", import.meta.url),
  );
  database
    .query(
      "INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at) VALUES('run','queued',20,5,'2026-01-01')",
    )
    .run();
  expect(
    database
      .query("SELECT search_profile_json profile FROM scout_runs WHERE id='run'")
      .get(),
  ).toEqual({ profile: '{"terms":[],"locations":[]}' });
  database.close();
});

test("0027 preserves attempts while naming their source method", async () => {
  const database = new Database(":memory:");
  await applyStatements(
    database,
    new URL("../migrations/0024_gig_scout.sql", import.meta.url),
  );
  await applyStatements(
    database,
    new URL("../migrations/0025_scout_reconciliation.sql", import.meta.url),
  );
  await applyStatements(
    database,
    new URL("../migrations/0026_scout_run_search_profile.sql", import.meta.url),
  );
  database.exec(`
    INSERT INTO scout_companies(id,name,created_at,updated_at)
    VALUES('company','Synthetic Company','2026-01-01','2026-01-01');
    INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at)
    VALUES('config','company',1,'fingerprint','2026-01-01');
    INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json)
    VALUES('source','config','official','json','{}');
    INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at)
    VALUES('run','completed',20,5,'2026-01-01');
    INSERT INTO scout_run_companies(id,run_id,company_id,company_configuration_id,status)
    VALUES('run-company','run','company','config','succeeded');
    INSERT INTO scout_run_sources(id,run_company_id,configuration_source_id,status,candidate_count,accepted_count,rejected_count)
    VALUES('run-source','run-company','source','succeeded_with_results',1,1,0);
    INSERT INTO scout_source_attempts(
      id,run_source_id,attempt_number,adapter,stage,request_count,response_count,
      candidate_count,accepted_count,rejected_count,validation_status,started_at,
      completed_at,records_received,records_parsed,records_evaluable,
      records_evaluated,pages_requested,pages_validated,unique_identities
    ) VALUES(
      'attempt','run-source',1,'json','listing_page_1',1,1,1,1,0,'passed',
      '2026-01-01','2026-01-01',1,1,1,1,1,1,1
    );
  `);

  await applyStatements(
    database,
    new URL("../migrations/0027_scout_attempt_source_method.sql", import.meta.url),
  );

  expect(
    database
      .query(
        "SELECT source_method sourceMethod,records_evaluated recordsEvaluated FROM scout_source_attempts WHERE id='attempt'",
      )
      .get(),
  ).toEqual({ sourceMethod: "json", recordsEvaluated: 1 });
  expect(() =>
    database.query("SELECT adapter FROM scout_source_attempts").get(),
  ).toThrow();
  database.close();
});

test("0029 adds durable bounded Scout screening comments",async()=>{
  const database=new Database(":memory:");
  migrateDatabase(database);
  const relevanceColumns=database.query("PRAGMA table_info(scout_relevance_evaluations)").all() as Array<{name:string}>;
  const matchColumns=database.query("PRAGMA table_info(scout_candidate_match_evaluations)").all() as Array<{name:string}>;
  const processingColumns=database.query("PRAGMA table_info(scout_position_processing)").all() as Array<{name:string}>;
  const backfillColumns=database.query("PRAGMA table_info(scout_position_backfill)").all() as Array<{name:string}>;
  expect(relevanceColumns.map(column=>column.name)).toContain("reason");
  expect(matchColumns.map(column=>column.name)).toContain("score_explanation");
  expect(matchColumns.map(column=>column.name)).not.toContain("strengths_json");
  expect(processingColumns.map(column=>column.name)).toEqual(expect.arrayContaining(["run_id","observation_id","description_id","criteria_id","relevance_evaluation_id","rubric_id"]));
  expect(backfillColumns.map(column=>column.name)).toContain("source_run_id");
  database.close();
});

test("0030 adds a source-bound backfill run without copied profile content",()=>{
  const database=new Database(":memory:");
  migrateDatabase(database);
  database.query(`INSERT INTO scout_runs(id,status,run_type,batch_size,concurrency,created_at,company_count) VALUES('source','completed','full',20,5,'2026-01-01',0)`).run();
  database.query(`INSERT INTO scout_runs(id,status,run_type,source_run_id,batch_size,concurrency,screening_cache_key,created_at,company_count) VALUES('backfill','running','legacy_backfill','source',20,5,'cache-key','2026-01-02',0)`).run();
  expect(database.query(`SELECT source_run_id sourceRunId,screening_cache_key cacheKey,candidate_profile_json profileJson FROM scout_runs WHERE id='backfill'`).get()).toEqual({sourceRunId:"source",cacheKey:"cache-key",profileJson:null});
  expect(()=>database.query(`INSERT INTO scout_runs(id,status,run_type,batch_size,concurrency,created_at,company_count) VALUES('invalid','running','legacy_backfill',20,5,'2026-01-03',0)`).run()).toThrow();
  database.close();
});

test("0031 preserves queued processing while adding an optional configuration-source binding",async()=>{
  const database=new Database(":memory:");
  database.exec("CREATE TABLE gigs(id text PRIMARY KEY,source_url text,company text,external_job_id text,is_deleted integer NOT NULL DEFAULT 0); CREATE TABLE gig_history(id text PRIMARY KEY); CREATE TABLE changes(id text PRIMARY KEY);");
  for(let index=24;index<=30;index++){
    const prefix=String(index).padStart(4,"0")+"_";
    const migration=[...new Bun.Glob(prefix+"*.sql").scanSync(new URL("../migrations",import.meta.url).pathname)][0]!;
    await applyStatements(database,new URL("../migrations/"+migration,import.meta.url));
  }
  database.exec(`
    INSERT INTO scout_companies(id,name,created_at,updated_at) VALUES('company','Synthetic Company','2026-01-01','2026-01-01');
    INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES('config','company',1,'fingerprint','2026-01-01');
    UPDATE scout_companies SET current_configuration_id='config' WHERE id='company';
    INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json) VALUES('source','config','official','json','{}');
    INSERT INTO scout_runs(id,status,batch_size,concurrency,created_at,company_count) VALUES('run','completed',20,5,'2026-01-01',1);
    INSERT INTO scout_run_companies(id,run_id,company_id,company_configuration_id,status) VALUES('run-company','run','company','config','succeeded');
    INSERT INTO scout_run_sources(id,run_company_id,configuration_source_id,status,candidate_count,accepted_count,rejected_count) VALUES('run-source','run-company','source','succeeded_with_results',1,1,0);
    INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,canonical_url,title,first_seen_at,last_seen_at) VALUES('position','company','official','canonical_url','https://careers.example.test/1','https://careers.example.test/1','Synthetic Role','2026-01-01','2026-01-01');
    INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES('observation','run-source','position','Synthetic Role','https://careers.example.test/1','{}','2026-01-01');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,stage,input_identity,status,created_at,updated_at) VALUES('processing','position','run','observation','acquire_description','identity','pending','2026-01-01','2026-01-01');
    INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,created_at) VALUES('outbox','processing','position:processing','2026-01-01');
  `);
  await applyStatements(database,new URL("../migrations/0031_scout_processing_configuration_binding.sql",import.meta.url));
  expect(database.query("PRAGMA table_info(scout_position_processing)").all()).toContainEqual(expect.objectContaining({name:"configuration_source_id",notnull:0}));
  expect(database.query("SELECT p.id,p.configuration_source_id configurationSourceId,o.queue_job_id queueJobId FROM scout_position_processing p JOIN scout_position_processing_outbox o ON o.processing_id=p.id").get()).toEqual({id:"processing",configurationSourceId:null,queueJobId:"position:processing"});
  expect(()=>database.query("UPDATE scout_position_processing SET configuration_source_id='missing' WHERE id='processing'").run()).toThrow();
  database.query("UPDATE scout_position_processing SET configuration_source_id='source' WHERE id='processing'").run();
  database.close();
});

test("0033 installs revision-bound Scout decision, note, and promotion storage",()=>{
  const database=new Database(":memory:");
  migrateDatabase(database);
  const stateColumns=database.query("PRAGMA table_info(scout_position_states)").all() as Array<{name:string}>;
  expect(stateColumns.map(column=>column.name)).toContain("current_decision_id");
  expect(database.query("PRAGMA table_info(scout_position_decisions)").all()).toEqual(expect.arrayContaining([expect.objectContaining({name:"origin"}),expect.objectContaining({name:"description_id"}),expect.objectContaining({name:"reverses_decision_id"})]));
  expect(database.query("PRAGMA table_info(scout_position_notes)").all()).toContainEqual(expect.objectContaining({name:"body"}));
  expect(database.query("PRAGMA table_info(scout_position_promotions)").all()).toContainEqual(expect.objectContaining({name:"managed_document_id"}));
  database.close();
});

test("0034 renames Gig availability columns and removes the Scout-specific history",async()=>{
  const database=new Database(":memory:");
  migrateDatabase(database);
  database.exec(`
    ALTER TABLE gigs RENAME COLUMN availability TO scout_availability;
    ALTER TABLE gigs RENAME COLUMN availability_updated_at TO scout_availability_updated_at;
    ALTER TABLE gig_history RENAME COLUMN availability TO scout_availability;
    ALTER TABLE gig_history RENAME COLUMN availability_updated_at TO scout_availability_updated_at;
    CREATE TABLE scout_gig_availability_history (history_id integer PRIMARY KEY);
    INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at,scout_availability,scout_availability_updated_at)
    VALUES('gig-1','Synthetic Company','Synthetic Role','identified','pending','Found','2026-08-20','good','[]',0,0,1,0,'2026-08-20T00:00:00Z','2026-08-20T00:00:00Z','available','2026-08-20T12:00:00Z');
    INSERT INTO changes(id,occurred_at,actor,source,summary,status)
    VALUES('availability-history','2026-08-20T12:00:00Z','test','test','Synthetic availability history','committed');
    INSERT INTO gig_history(change_id,operation,recorded_at,recorded_by,id,company,title,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at,scout_availability,scout_availability_updated_at)
    VALUES('availability-history','update','2026-08-20T12:00:00Z','test','gig-1','Synthetic Company','Synthetic Role','identified','pending','Found','2026-08-20','good','[]',0,0,1,0,'2026-08-20T00:00:00Z','2026-08-20T00:00:00Z','unavailable','2026-08-19T12:00:00Z');
  `);
  await applyStatements(database,new URL("../migrations/0034_gig_domain_availability.sql",import.meta.url));
  expect(columnNames(database,"gigs")).toEqual(expect.arrayContaining(["availability","availability_updated_at"]));
  expect(columnNames(database,"gigs")).not.toContain("scout_availability");
  expect(columnNames(database,"gig_history")).toEqual(expect.arrayContaining(["availability","availability_updated_at"]));
  expect(columnNames(database,"gig_history")).not.toContain("scout_availability");
  expect(tableNames(database)).not.toContain("scout_gig_availability_history");
  expect(database.query("SELECT availability,availability_updated_at FROM gigs WHERE id='gig-1'").get()).toEqual({availability:"available",availability_updated_at:"2026-08-20T12:00:00Z"});
  expect(database.query("SELECT availability,availability_updated_at FROM gig_history WHERE id='gig-1'").get()).toEqual({availability:"unavailable",availability_updated_at:"2026-08-19T12:00:00Z"});
  database.close();
});

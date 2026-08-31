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

test("0035 through 0037 preserve durable Scout history while extending explicit position backfill storage",async()=>{
  const database=new Database(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(`
    CREATE TABLE changes(id text PRIMARY KEY,occurred_at text NOT NULL,actor text NOT NULL,source text NOT NULL,summary text NOT NULL,status text NOT NULL);
    CREATE TABLE gigs(id text PRIMARY KEY,company text NOT NULL,title text NOT NULL,stage text NOT NULL,outcome text NOT NULL,status_summary text NOT NULL,last_activity text NOT NULL,fit_rating text NOT NULL,tags_json text NOT NULL,has_job_description integer NOT NULL,has_interview_prep integer NOT NULL,revision integer NOT NULL,is_deleted integer NOT NULL,created_at text NOT NULL,updated_at text NOT NULL,external_job_id text,source_url text);
    CREATE TABLE gig_history(history_id integer PRIMARY KEY,change_id text NOT NULL,operation text NOT NULL,recorded_at text NOT NULL,recorded_by text NOT NULL,id text NOT NULL,company text NOT NULL,title text NOT NULL,stage text NOT NULL,outcome text NOT NULL,status_summary text NOT NULL,last_activity text NOT NULL,fit_rating text NOT NULL,tags_json text NOT NULL,has_job_description integer NOT NULL,has_interview_prep integer NOT NULL,revision integer NOT NULL,is_deleted integer NOT NULL,created_at text NOT NULL,updated_at text NOT NULL,external_job_id text,source_url text);
    CREATE TABLE managed_documents(id text PRIMARY KEY,document_type text NOT NULL,title text,description text,media_type text NOT NULL,source_description text,file_path text,materialized_version integer,upload_provenance_json text,current_version integer NOT NULL,created_at text NOT NULL,updated_at text NOT NULL);
    CREATE TABLE managed_document_links(id integer PRIMARY KEY AUTOINCREMENT,document_id text NOT NULL REFERENCES managed_documents(id),gig_id text REFERENCES gigs(id));
    CREATE TABLE managed_document_versions(document_id text NOT NULL REFERENCES managed_documents(id),version integer NOT NULL,parent_version integer,content text NOT NULL,content_hash text NOT NULL,change_id text NOT NULL REFERENCES changes(id),change_summary text NOT NULL,created_at text NOT NULL,created_by text NOT NULL,PRIMARY KEY(document_id,version));
  `);
  for(let index=24;index<=34;index++){
    const prefix=String(index).padStart(4,"0")+"_";
    const migration=[...new Bun.Glob(prefix+"*.sql").scanSync(new URL("../migrations",import.meta.url).pathname)][0];
    if(migration)await applyStatements(database,new URL("../migrations/"+migration,import.meta.url));
  }
  database.exec(`
    INSERT INTO changes(id,occurred_at,actor,source,summary,status) VALUES('document-change','2026-01-01','Synthetic','test','Synthetic document','committed');
    INSERT INTO gigs(id,company,title,stage,outcome,status_summary,last_activity,fit_rating,tags_json,has_job_description,has_interview_prep,revision,is_deleted,created_at,updated_at) VALUES('gig','Synthetic Company','Synthetic Role','identified','pending','Synthetic','2026-01-01','good','[]',1,0,1,0,'2026-01-01','2026-01-01');
    INSERT INTO managed_documents(id,document_type,title,media_type,source_description,current_version,created_at,updated_at) VALUES('document','job_description','Synthetic Role','text/markdown','Synthetic source',1,'2026-01-01','2026-01-01');
    INSERT INTO managed_document_links(document_id,gig_id) VALUES('document','gig');
    INSERT INTO managed_document_versions(document_id,version,parent_version,content,content_hash,change_id,change_summary,created_at,created_by) VALUES('document',1,NULL,'Synthetic content','content-hash','document-change','Synthetic version','2026-01-01','Synthetic');
    INSERT INTO scout_companies(id,name,current_configuration_id,created_at,updated_at) VALUES('company','Synthetic Company','config','2026-01-01','2026-01-01');
    INSERT INTO scout_company_configurations(id,company_id,version,fingerprint,created_at) VALUES('config','company',1,'config-fingerprint','2026-01-01');
    INSERT INTO scout_company_configuration_sources(id,company_configuration_id,source_key,source_type,settings_json) VALUES('source','config','official','json','{}');
    INSERT INTO scout_runs(id,status,run_type,batch_size,concurrency,created_at,company_count) VALUES('full-run','completed','full',20,5,'2026-01-01',1);
    INSERT INTO scout_runs(id,status,run_type,source_run_id,batch_size,concurrency,screening_cache_key,created_at,company_count) VALUES('legacy-run','completed','legacy_backfill','full-run',20,5,'cache-key','2026-01-02',0);
    INSERT INTO scout_run_companies(id,run_id,company_id,company_configuration_id,status) VALUES('run-company','full-run','company','config','succeeded');
    INSERT INTO scout_run_sources(id,run_company_id,configuration_source_id,status,candidate_count,accepted_count,rejected_count) VALUES('run-source','run-company','source','succeeded_with_results',1,1,0);
    INSERT INTO scout_positions(id,company_id,source_key,identity_kind,identity_value,canonical_url,title,first_seen_at,last_seen_at) VALUES('position','company','official','canonical_url','https://careers.example.test/1','https://careers.example.test/1','Synthetic Role','2026-01-01','2026-01-01');
    INSERT INTO scout_position_observations(id,run_source_id,position_id,title,canonical_url,provenance_json,observed_at) VALUES('observation','run-source','position','Synthetic Role','https://careers.example.test/1','{}','2026-01-01');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,stage,input_identity,status,attempt_count,created_at,updated_at,completed_at) VALUES('processing','position','legacy-run','observation','source','reconcile_gig','identity','completed',1,'2026-01-02','2026-01-02','2026-01-02');
    INSERT INTO scout_position_processing_outbox(id,processing_id,queue_job_id,dispatch_status,created_at,dispatched_at) VALUES('outbox','processing','position:processing','dispatched','2026-01-02','2026-01-02');
  `);
  const beforeRunRows=database.query(`SELECT * FROM scout_runs ORDER BY created_at`).all();
  const beforeObservationRows=database.query(`SELECT * FROM scout_position_observations ORDER BY id`).all();
  const beforeProcessingRows=database.query(`SELECT * FROM scout_position_processing ORDER BY id`).all();
  const beforeOutboxRows=database.query(`SELECT * FROM scout_position_processing_outbox ORDER BY id`).all();
  const beforeVersions=database.query(`SELECT * FROM managed_document_versions ORDER BY document_id,version`).all();

  await applyStatements(database,new URL("../migrations/0035_position_backfill.sql",import.meta.url));

  const runTypes=(database.query(`SELECT run_type runType FROM scout_runs ORDER BY created_at`).all() as Array<{runType:string}>).map(row=>row.runType);
  expect(runTypes).toEqual(["full","legacy_backfill"]);
  expect(database.query(`SELECT id,status,run_type,source_run_id,batch_size,concurrency,search_profile_json,screening_cache_key,candidate_profile_json,candidate_profile_version,candidate_profile_artifact_id,candidate_profile_hash,created_at,started_at,completed_at,company_count,succeeded_count,failed_count FROM scout_runs ORDER BY created_at`).all()).toEqual(beforeRunRows);
  expect(database.query(`SELECT * FROM scout_position_observations ORDER BY id`).all()).toEqual(beforeObservationRows);
  expect(database.query(`SELECT id,position_id,run_id,observation_id,configuration_source_id,description_id,criteria_id,relevance_evaluation_id,rubric_id,stage,input_identity,status,attempt_count,failure_code,failure_message,created_at,updated_at,completed_at FROM scout_position_processing ORDER BY id`).all()).toEqual(beforeProcessingRows);
  expect(database.query(`SELECT * FROM scout_position_processing_outbox ORDER BY id`).all()).toEqual(beforeOutboxRows);
  expect(columnNames(database,"scout_runs")).toEqual(expect.arrayContaining(["operator_reason","request_fingerprint","screening_model","screening_provider","screening_model_configuration"]));
  expect(database.query(`SELECT screening_model model,screening_provider provider,screening_model_configuration modelConfiguration FROM scout_runs ORDER BY created_at`).all()).toEqual([
    {model:null,provider:null,modelConfiguration:null},
    {model:null,provider:null,modelConfiguration:null},
  ]);
  expect(tableNames(database)).toContain("scout_position_backfill_items");
  expect(columnNames(database,"scout_position_processing")).toContain("document_projection_status");
  expect(database.query(`SELECT document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id='processing'`).get()).toEqual({documentProjectionStatus:null});
  expect(()=>database.query(`UPDATE scout_position_processing SET document_projection_status='inferred' WHERE id='processing'`).run()).toThrow();
  expect(columnNames(database,"managed_document_versions")).toEqual(expect.arrayContaining(["source_description","source_provenance_json"]));
  expect(database.query(`SELECT document_id,version,parent_version,content,content_hash,change_id,change_summary,created_at,created_by FROM managed_document_versions`).all()).toEqual(beforeVersions);
  expect(database.query(`SELECT source_description sourceDescription,source_provenance_json sourceProvenance FROM managed_document_versions`).get()).toEqual({sourceDescription:null,sourceProvenance:null});

  const insertIncompleteBackfill=database.query(`INSERT INTO scout_runs(id,status,run_type,batch_size,concurrency,operator_reason,request_fingerprint,created_at,company_count) VALUES(?,'running','position_backfill',20,5,?,?,?,0)`);
  expect(()=>insertIncompleteBackfill.run("missing-contract",null,null,"2026-01-03")).toThrow();
  expect(()=>insertIncompleteBackfill.run("missing-screening","Synthetic repair","b".repeat(64),"2026-01-03")).toThrow();
  const insertBackfill=database.query(`INSERT INTO scout_runs(id,status,run_type,batch_size,concurrency,screening_cache_key,candidate_profile_json,candidate_profile_version,candidate_profile_artifact_id,candidate_profile_hash,screening_model,screening_provider,screening_model_configuration,operator_reason,request_fingerprint,created_at,company_count) VALUES(?,'running','position_backfill',20,5,'cache-key','{}','profile-v1','profile-artifact-v1','profile-hash-v1','model-v1','provider-v1','configuration-v1',?,?,?,0)`);
  expect(()=>insertBackfill.run("empty-reason","","a".repeat(64),"2026-01-03")).toThrow();
  expect(()=>insertBackfill.run("invalid-fingerprint","Synthetic repair","A".repeat(64),"2026-01-03")).toThrow();
  insertBackfill.run("pending-backfill","Synthetic pending repair","a".repeat(64),"2026-01-03");
  expect(()=>insertBackfill.run("duplicate-backfill","Another repair","a".repeat(64),"2026-01-04")).toThrow();
  insertBackfill.run("completed-backfill","Synthetic completed repair","b".repeat(64),"2026-01-04");
  database.exec(`
    INSERT INTO scout_description_artifacts(id,file_path,content_hash,media_type,byte_count,provenance_json,created_at)
    VALUES('artifact','aa/description.md','description-hash','text/markdown',21,'{}','2026-01-03');
    INSERT INTO scout_position_descriptions(id,position_id,artifact_id,source_url,retrieved_at,source_content_hash,markdown_content_hash,converter_version,created_at)
    VALUES('description','position','artifact','https://careers.example.test/1','2026-01-03','source-hash','description-hash','converter-v1','2026-01-03');
    INSERT INTO changes(id,occurred_at,actor,source,summary,status)
    VALUES('promotion-change','2026-01-03','Synthetic','test','Synthetic promotion','committed');
    INSERT INTO scout_position_decisions(id,change_id,position_id,action,origin,actor,expected_state_revision,resulting_state_revision,created_at)
    VALUES('promotion-decision','promotion-change','position','pursue','system','Synthetic',1,2,'2026-01-03');
    INSERT INTO scout_position_states(position_id,state,linked_gig_id,current_decision_id,revision,created_at,updated_at)
    VALUES('position','promoted','gig','promotion-decision',2,'2026-01-03','2026-01-03');
    INSERT INTO scout_position_promotions(id,decision_id,position_id,description_id,gig_id,managed_document_id,status,created_at,updated_at,completed_at)
    VALUES('promotion','promotion-decision','position','description','gig','document','completed','2026-01-03','2026-01-03','2026-01-03');
    INSERT INTO scout_position_backfill_items(run_id,position_id,observation_id,configuration_source_id,linked_gig_id,requested_at)
    VALUES('pending-backfill','position','observation','source','gig','2026-01-03');
    INSERT INTO scout_position_backfill_items(run_id,position_id,observation_id,configuration_source_id,linked_gig_id,requested_at)
    VALUES('completed-backfill','position','observation','source','gig','2026-01-04');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,description_id,stage,input_identity,status,attempt_count,document_projection_status,created_at,updated_at)
    VALUES('pending-acquisition','position','pending-backfill','observation','source','description','acquire_description','pending-acquisition-identity','pending',1,'failed','2026-01-03','2026-01-03');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,stage,input_identity,status,attempt_count,created_at,updated_at,completed_at)
    VALUES('completed-reconcile','position','completed-backfill','observation','source','reconcile_gig','completed-reconcile-identity','completed',1,'2026-01-04','2026-01-04','2026-01-04');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,description_id,stage,input_identity,status,attempt_count,document_projection_status,created_at,updated_at,completed_at)
    VALUES('completed-acquisition','position','completed-backfill','observation','source','description','acquire_description','completed-acquisition-identity','completed',1,'updated','2026-01-04','2026-01-05','2026-01-05');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,description_id,stage,input_identity,status,attempt_count,created_at,updated_at,completed_at)
    VALUES('completed-relevance','position','completed-backfill','observation','source','description','screen_relevance','completed-relevance-identity','completed',1,'2026-01-04','2026-01-05','2026-01-05');
    INSERT INTO scout_position_processing(id,position_id,run_id,observation_id,configuration_source_id,description_id,stage,input_identity,status,attempt_count,created_at,updated_at,completed_at)
    VALUES('completed-match','position','completed-backfill','observation','source','description','score_candidate_match','completed-match-identity','completed',1,'2026-01-04','2026-01-05','2026-01-05');
  `);

  await applyStatements(database,new URL("../migrations/0036_bizarre_doomsday.sql",import.meta.url));
  await applyStatements(database,new URL("../migrations/0037_worried_nova.sql",import.meta.url));

  expect(tableNames(database)).toContain("scout_description_acquisitions");
  expect(columnNames(database,"scout_position_backfill_items")).toEqual(expect.arrayContaining(["company_name","template_name","initial_state","initial_decision_origin","description_outcome","final_outcome","failure_code","completed_at"]));
  expect(database.query(`SELECT description_id descriptionId,attempt_count attemptCount,failure_code failureCode,document_projection_status documentProjectionStatus FROM scout_position_processing WHERE id='pending-acquisition'`).get()).toEqual({descriptionId:null,attemptCount:0,failureCode:null,documentProjectionStatus:null});
  expect(database.query(`SELECT run_id runId,position_id positionId,observation_id observationId,configuration_source_id configurationSourceId,linked_gig_id linkedGigId,requested_at requestedAt,company_name companyName,template_name templateName,final_outcome finalOutcome,completed_at completedAt FROM scout_position_backfill_items WHERE run_id='pending-backfill'`).get()).toEqual({runId:"pending-backfill",positionId:"position",observationId:"observation",configurationSourceId:"source",linkedGigId:"gig",requestedAt:"2026-01-03",companyName:"Synthetic Company",templateName:"custom",finalOutcome:null,completedAt:null});
  expect(database.query(`SELECT company_name companyName,template_name templateName,final_outcome finalOutcome,completed_at completedAt FROM scout_position_backfill_items WHERE run_id='completed-backfill'`).get()).toEqual({companyName:"Synthetic Company",templateName:"custom",finalOutcome:"promoted",completedAt:"2026-01-05"});
  expect(database.query(`SELECT status,completed_at completedAt FROM scout_runs WHERE id='pending-backfill'`).get()).toEqual({status:"running",completedAt:null});
  expect(database.query(`SELECT status,completed_at completedAt FROM scout_runs WHERE id='completed-backfill'`).get()).toEqual({status:"completed",completedAt:"2026-01-05"});
  expect(()=>database.query(`UPDATE scout_position_backfill_items SET description_outcome='invalid'`).run()).toThrow();
  expect(()=>database.query(`UPDATE scout_position_backfill_items SET final_outcome='invalid'`).run()).toThrow();
  expect(database.query(`PRAGMA foreign_key_check`).all()).toEqual([]);
  database.close();
});

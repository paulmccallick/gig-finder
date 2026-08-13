import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

const applyStatements = async (database: Database, migrationUrl: URL) => {
  const sql = await Bun.file(migrationUrl).text();
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
};

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

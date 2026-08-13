PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE scout_source_attempts_replacement (
  id text PRIMARY KEY,
  run_source_id text NOT NULL REFERENCES scout_run_sources(id),
  attempt_number integer NOT NULL,
  source_method text NOT NULL CHECK(source_method IN ('json','html')),
  stage text NOT NULL,
  request_count integer NOT NULL,
  response_count integer NOT NULL,
  candidate_count integer NOT NULL,
  accepted_count integer NOT NULL,
  rejected_count integer NOT NULL,
  validation_status text NOT NULL,
  started_at text NOT NULL,
  completed_at text NOT NULL,
  failure_code text CHECK(failure_code IS NULL OR length(failure_code) <= 100),
  failure_message text CHECK(failure_message IS NULL OR length(failure_message) <= 500),
  source_reported_total integer CHECK(source_reported_total IS NULL OR source_reported_total >= 0),
  records_received integer NOT NULL DEFAULT 0 CHECK(records_received >= 0),
  records_parsed integer NOT NULL DEFAULT 0 CHECK(records_parsed >= 0),
  records_evaluable integer NOT NULL DEFAULT 0 CHECK(records_evaluable >= 0),
  records_evaluated integer NOT NULL DEFAULT 0 CHECK(records_evaluated >= 0),
  pages_requested integer NOT NULL DEFAULT 0 CHECK(pages_requested >= 0),
  pages_validated integer NOT NULL DEFAULT 0 CHECK(pages_validated >= 0),
  unique_identities integer NOT NULL DEFAULT 0 CHECK(unique_identities >= 0),
  UNIQUE(run_source_id, attempt_number)
);--> statement-breakpoint
INSERT INTO scout_source_attempts_replacement (
  id, run_source_id, attempt_number, source_method, stage, request_count,
  response_count, candidate_count, accepted_count, rejected_count,
  validation_status, started_at, completed_at, failure_code, failure_message,
  source_reported_total, records_received, records_parsed, records_evaluable,
  records_evaluated, pages_requested, pages_validated, unique_identities
)
SELECT
  id, run_source_id, attempt_number, adapter, stage, request_count,
  response_count, candidate_count, accepted_count, rejected_count,
  validation_status, started_at, completed_at, failure_code, failure_message,
  source_reported_total, records_received, records_parsed, records_evaluable,
  records_evaluated, pages_requested, pages_validated, unique_identities
FROM scout_source_attempts;--> statement-breakpoint
DROP TABLE scout_source_attempts;--> statement-breakpoint
ALTER TABLE scout_source_attempts_replacement RENAME TO scout_source_attempts;--> statement-breakpoint
PRAGMA foreign_keys=ON;

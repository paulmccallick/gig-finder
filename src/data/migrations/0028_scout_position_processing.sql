ALTER TABLE gigs ADD COLUMN scout_availability text NOT NULL DEFAULT 'unknown' CHECK(scout_availability IN ('unknown','available','unavailable'));
--> statement-breakpoint
ALTER TABLE gigs ADD COLUMN scout_availability_updated_at text;
--> statement-breakpoint
ALTER TABLE gig_history ADD COLUMN scout_availability text NOT NULL DEFAULT 'unknown' CHECK(scout_availability IN ('unknown','available','unavailable'));
--> statement-breakpoint
ALTER TABLE gig_history ADD COLUMN scout_availability_updated_at text;
--> statement-breakpoint
CREATE TABLE scout_position_states (
  position_id text PRIMARY KEY REFERENCES scout_positions(id),
  state text NOT NULL CHECK(state IN ('processing','needs_user_review','irrelevant','rejected','deferred','promoted')),
  linked_gig_id text REFERENCES gigs(id),
  deferred_until text,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK((state='promoted' AND linked_gig_id IS NOT NULL) OR (state<>'promoted' AND linked_gig_id IS NULL)),
  CHECK(state='deferred' OR deferred_until IS NULL)
);
--> statement-breakpoint
CREATE INDEX scout_position_linked_gig_idx ON scout_position_states(linked_gig_id) WHERE linked_gig_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX scout_position_state_workspace_idx ON scout_position_states(state,updated_at,position_id);
--> statement-breakpoint
CREATE TABLE scout_position_state_history (
  history_id integer PRIMARY KEY AUTOINCREMENT,
  change_id text NOT NULL REFERENCES changes(id),
  operation text NOT NULL CHECK(operation IN ('create','update')),
  recorded_at text NOT NULL,
  recorded_by text NOT NULL,
  position_id text NOT NULL,
  state text NOT NULL,
  linked_gig_id text,
  deferred_until text,
  revision integer NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX scout_position_state_history_position_idx ON scout_position_state_history(position_id,revision);
--> statement-breakpoint
CREATE TABLE scout_position_processing (
  id text PRIMARY KEY,
  position_id text NOT NULL REFERENCES scout_positions(id),
  stage text NOT NULL CHECK(stage IN ('reconcile_gig')),
  input_identity text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','completed','failed','superseded')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  failure_code text CHECK(failure_code IS NULL OR length(failure_code)<=100),
  failure_message text CHECK(failure_message IS NULL OR length(failure_message)<=500),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  completed_at text,
  UNIQUE(position_id,stage,input_identity)
);
--> statement-breakpoint
CREATE INDEX scout_position_processing_work_idx ON scout_position_processing(stage,status,updated_at,id);
--> statement-breakpoint
CREATE TABLE scout_position_processing_outbox (
  id text PRIMARY KEY,
  processing_id text NOT NULL UNIQUE REFERENCES scout_position_processing(id),
  queue_job_id text NOT NULL UNIQUE,
  dispatch_status text NOT NULL DEFAULT 'pending' CHECK(dispatch_status IN ('pending','dispatched')),
  created_at text NOT NULL,
  dispatched_at text
);
--> statement-breakpoint
CREATE INDEX scout_position_outbox_pending_idx ON scout_position_processing_outbox(dispatch_status,created_at,id);
--> statement-breakpoint
CREATE TABLE scout_position_backfill (
  name text PRIMARY KEY,
  last_position_id text,
  completed_at text,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE scout_gig_availability_history (
  history_id integer PRIMARY KEY AUTOINCREMENT,
  change_id text NOT NULL REFERENCES changes(id),
  gig_id text NOT NULL REFERENCES gigs(id),
  prior_availability text NOT NULL CHECK(prior_availability IN ('unknown','available','unavailable')),
  availability text NOT NULL CHECK(availability IN ('available','unavailable')),
  recorded_at text NOT NULL,
  recorded_by text NOT NULL,
  run_id text NOT NULL REFERENCES scout_runs(id)
);
--> statement-breakpoint
CREATE INDEX scout_gig_availability_history_gig_idx ON scout_gig_availability_history(gig_id,recorded_at,history_id);
--> statement-breakpoint
CREATE INDEX scout_positions_workspace_idx ON scout_positions(company_id,last_seen_at,id);
--> statement-breakpoint
CREATE INDEX scout_positions_exact_url_idx ON scout_positions(canonical_url);
--> statement-breakpoint
CREATE INDEX scout_positions_exact_external_idx ON scout_positions(company_id,external_id) WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX scout_observations_position_history_idx ON scout_position_observations(position_id,observed_at,id);
--> statement-breakpoint
CREATE INDEX gigs_exact_source_url_idx ON gigs(source_url) WHERE is_deleted=0 AND source_url IS NOT NULL;
--> statement-breakpoint
CREATE INDEX gigs_exact_company_external_idx ON gigs(company,external_job_id) WHERE is_deleted=0 AND external_job_id IS NOT NULL;

PRAGMA foreign_keys=OFF;
--> statement-breakpoint
ALTER TABLE scout_runs ADD COLUMN screening_cache_key text;
--> statement-breakpoint
ALTER TABLE scout_runs ADD COLUMN candidate_profile_json text;
--> statement-breakpoint
ALTER TABLE scout_runs ADD COLUMN candidate_profile_version text;
--> statement-breakpoint
ALTER TABLE scout_runs ADD COLUMN candidate_profile_artifact_id text;
--> statement-breakpoint
ALTER TABLE scout_runs ADD COLUMN candidate_profile_hash text;
--> statement-breakpoint
ALTER TABLE scout_position_backfill ADD COLUMN source_run_id text REFERENCES scout_runs(id);
--> statement-breakpoint
ALTER TABLE scout_position_processing RENAME TO scout_position_processing_old;
--> statement-breakpoint
ALTER TABLE scout_position_processing_outbox RENAME TO scout_position_processing_outbox_old;
--> statement-breakpoint
DROP INDEX scout_position_processing_work_idx;
--> statement-breakpoint
DROP INDEX scout_position_outbox_pending_idx;
--> statement-breakpoint
CREATE TABLE scout_position_processing (
 id text PRIMARY KEY,
 position_id text NOT NULL REFERENCES scout_positions(id),
 run_id text REFERENCES scout_runs(id),
 observation_id text REFERENCES scout_position_observations(id),
 description_id text REFERENCES scout_position_descriptions(id),
 criteria_id text REFERENCES scout_relevance_criteria(id),
 relevance_evaluation_id text REFERENCES scout_relevance_evaluations(id),
 rubric_id text REFERENCES scout_candidate_match_rubrics(id),
 stage text NOT NULL CHECK(stage IN ('reconcile_gig','acquire_description','screen_relevance','score_candidate_match')),
 input_identity text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','completed','failed','superseded')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 failure_code text CHECK(failure_code IS NULL OR length(failure_code)<=100),
 failure_message text CHECK(failure_message IS NULL OR length(failure_message)<=500),
 created_at text NOT NULL, updated_at text NOT NULL, completed_at text,
 UNIQUE(position_id,stage,input_identity)
);
--> statement-breakpoint
INSERT INTO scout_position_processing(id,position_id,stage,input_identity,status,attempt_count,failure_code,failure_message,created_at,updated_at,completed_at)
SELECT id,position_id,stage,input_identity,status,attempt_count,failure_code,failure_message,created_at,updated_at,completed_at FROM scout_position_processing_old;
--> statement-breakpoint
CREATE INDEX scout_position_processing_work_idx ON scout_position_processing(stage,status,updated_at,id);
--> statement-breakpoint
CREATE TABLE scout_position_processing_outbox (
 id text PRIMARY KEY, processing_id text NOT NULL UNIQUE REFERENCES scout_position_processing(id),
 queue_job_id text NOT NULL UNIQUE, dispatch_status text NOT NULL DEFAULT 'pending' CHECK(dispatch_status IN ('pending','dispatched')),
 created_at text NOT NULL, dispatched_at text
);
--> statement-breakpoint
INSERT INTO scout_position_processing_outbox SELECT * FROM scout_position_processing_outbox_old;
--> statement-breakpoint
CREATE INDEX scout_position_outbox_pending_idx ON scout_position_processing_outbox(dispatch_status,created_at,id);
--> statement-breakpoint
DROP TABLE scout_position_processing_outbox_old;
--> statement-breakpoint
DROP TABLE scout_position_processing_old;
--> statement-breakpoint
CREATE TABLE scout_position_descriptions (
 id text PRIMARY KEY, position_id text NOT NULL REFERENCES scout_positions(id), artifact_id text NOT NULL REFERENCES scout_description_artifacts(id),
 source_url text NOT NULL, retrieved_at text NOT NULL, source_content_hash text NOT NULL, markdown_content_hash text NOT NULL,
 converter_version text NOT NULL, created_at text NOT NULL, UNIQUE(position_id,markdown_content_hash,converter_version)
);
--> statement-breakpoint
CREATE TABLE scout_relevance_criteria (id text PRIMARY KEY,version integer NOT NULL UNIQUE,criteria text NOT NULL,confidence_threshold integer NOT NULL CHECK(confidence_threshold BETWEEN 0 AND 1000),prompt_version text NOT NULL,created_at text NOT NULL);
--> statement-breakpoint
CREATE TABLE scout_candidate_match_rubrics (id text PRIMARY KEY,version integer NOT NULL UNIQUE,rubric text NOT NULL,prompt_version text NOT NULL,created_at text NOT NULL);
--> statement-breakpoint
CREATE TABLE scout_relevance_evaluations (
 id text PRIMARY KEY,position_id text NOT NULL REFERENCES scout_positions(id),description_id text NOT NULL REFERENCES scout_position_descriptions(id),criteria_id text NOT NULL REFERENCES scout_relevance_criteria(id),input_identity text NOT NULL UNIQUE,
 decision text NOT NULL CHECK(decision IN ('fails_relevance','passes_relevance')),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 255),confidence integer NOT NULL CHECK(confidence BETWEEN 0 AND 1000),evidence_json text NOT NULL,ambiguities_json text NOT NULL,
 provider text NOT NULL,model text NOT NULL,model_configuration text NOT NULL,input_tokens integer,output_tokens integer,cache_read_tokens integer,cache_write_tokens integer,latency_ms integer NOT NULL,created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE scout_candidate_match_evaluations (
 id text PRIMARY KEY,position_id text NOT NULL REFERENCES scout_positions(id),relevance_evaluation_id text NOT NULL REFERENCES scout_relevance_evaluations(id),input_identity text NOT NULL UNIQUE,
 profile_version text NOT NULL,profile_artifact_id text NOT NULL,profile_hash text NOT NULL,rubric_id text NOT NULL REFERENCES scout_candidate_match_rubrics(id),score integer NOT NULL CHECK(score BETWEEN 1 AND 10),
 score_explanation text NOT NULL CHECK(length(score_explanation) BETWEEN 1 AND 310),provider text NOT NULL,model text NOT NULL,model_configuration text NOT NULL,input_tokens integer,output_tokens integer,cache_read_tokens integer,cache_write_tokens integer,latency_ms integer NOT NULL,created_at text NOT NULL
);
--> statement-breakpoint
INSERT INTO scout_relevance_criteria(id,version,criteria,confidence_threshold,prompt_version,created_at) VALUES('src_technology_leadership_v1',1,'The position is a technology leadership role: it leads software engineering, technology, data, security, infrastructure, or a closely related technical function. Definitively non-technology roles fail. Uncertain or mixed roles pass.',850,'scout-relevance-v1',datetime('now'));
--> statement-breakpoint
INSERT INTO scout_candidate_match_rubrics(id,version,rubric,prompt_version,created_at) VALUES('smr_candidate_match_v1',1,'Score candidate suitability from 1 (very poor match) to 10 (exceptional match). Ground the score in role scope, leadership level, functional expertise, industry context, location constraints, strengths, gaps, and material risks. Do not recommend an action.', 'scout-candidate-match-v1',datetime('now'));
--> statement-breakpoint
PRAGMA foreign_keys=ON;

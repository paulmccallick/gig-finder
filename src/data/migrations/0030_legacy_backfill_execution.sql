PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `scout_runs_new` (
 `id` text PRIMARY KEY,
 `status` text NOT NULL CHECK(status IN ('queued','running','completed','partial','failed')),
 `run_type` text NOT NULL DEFAULT 'full' CHECK(run_type IN ('full','legacy_backfill')),
 `source_run_id` text REFERENCES scout_runs(id),
 `batch_size` integer NOT NULL CHECK(batch_size > 0),
 `concurrency` integer NOT NULL CHECK(concurrency > 0),
 `search_profile_json` text NOT NULL DEFAULT '{"terms":[],"locations":[]}',
 `screening_cache_key` text,
 `candidate_profile_json` text,
 `candidate_profile_version` text,
 `candidate_profile_artifact_id` text,
 `candidate_profile_hash` text,
 `created_at` text NOT NULL,
 `started_at` text,
 `completed_at` text,
 `company_count` integer NOT NULL DEFAULT 0,
 `succeeded_count` integer NOT NULL DEFAULT 0,
 `failed_count` integer NOT NULL DEFAULT 0,
 CHECK((run_type='full' AND source_run_id IS NULL) OR (run_type='legacy_backfill' AND source_run_id IS NOT NULL))
);--> statement-breakpoint
INSERT INTO `scout_runs_new` (`id`,`status`,`run_type`,`source_run_id`,`batch_size`,`concurrency`,`search_profile_json`,`screening_cache_key`,`candidate_profile_json`,`candidate_profile_version`,`candidate_profile_artifact_id`,`candidate_profile_hash`,`created_at`,`started_at`,`completed_at`,`company_count`,`succeeded_count`,`failed_count`)
SELECT `id`,`status`,`run_type`,NULL,`batch_size`,`concurrency`,`search_profile_json`,`screening_cache_key`,`candidate_profile_json`,`candidate_profile_version`,`candidate_profile_artifact_id`,`candidate_profile_hash`,`created_at`,`started_at`,`completed_at`,`company_count`,`succeeded_count`,`failed_count` FROM `scout_runs`;--> statement-breakpoint
DROP TABLE `scout_runs`;--> statement-breakpoint
ALTER TABLE `scout_runs_new` RENAME TO `scout_runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `scout_runs_one_active_full_idx` ON `scout_runs` (`run_type`) WHERE run_type='full' AND status IN ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX `scout_runs_legacy_backfill_source_idx` ON `scout_runs` (`source_run_id`) WHERE run_type='legacy_backfill';--> statement-breakpoint
PRAGMA foreign_keys=ON;

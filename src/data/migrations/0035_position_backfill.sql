PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `scout_runs_new` (
 `id` text PRIMARY KEY,
 `status` text NOT NULL CHECK(status IN ('queued','running','completed','partial','failed')),
 `run_type` text NOT NULL DEFAULT 'full' CHECK(run_type IN ('full','legacy_backfill','position_backfill')),
 `source_run_id` text REFERENCES scout_runs(id),
 `operator_reason` text,
 `request_fingerprint` text,
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
 CHECK(
  (run_type='full' AND source_run_id IS NULL AND operator_reason IS NULL AND request_fingerprint IS NULL)
  OR (run_type='legacy_backfill' AND source_run_id IS NOT NULL AND operator_reason IS NULL AND request_fingerprint IS NULL)
  OR (
   run_type='position_backfill'
   AND source_run_id IS NULL
   AND operator_reason IS NOT NULL
   AND length(operator_reason) BETWEEN 1 AND 500
   AND operator_reason=trim(operator_reason)
   AND request_fingerprint IS NOT NULL
   AND length(request_fingerprint)=64
   AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
  )
 )
);
--> statement-breakpoint
INSERT INTO `scout_runs_new` (
 `id`,`status`,`run_type`,`source_run_id`,`operator_reason`,`request_fingerprint`,
 `batch_size`,`concurrency`,`search_profile_json`,`screening_cache_key`,
 `candidate_profile_json`,`candidate_profile_version`,`candidate_profile_artifact_id`,
 `candidate_profile_hash`,`created_at`,`started_at`,`completed_at`,`company_count`,
 `succeeded_count`,`failed_count`
)
SELECT
 `id`,`status`,`run_type`,`source_run_id`,NULL,NULL,`batch_size`,`concurrency`,
 `search_profile_json`,`screening_cache_key`,`candidate_profile_json`,
 `candidate_profile_version`,`candidate_profile_artifact_id`,`candidate_profile_hash`,
 `created_at`,`started_at`,`completed_at`,`company_count`,`succeeded_count`,`failed_count`
FROM `scout_runs`;
--> statement-breakpoint
DROP TABLE `scout_runs`;
--> statement-breakpoint
ALTER TABLE `scout_runs_new` RENAME TO `scout_runs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `scout_runs_one_active_full_idx` ON `scout_runs` (`run_type`) WHERE run_type='full' AND status IN ('queued','running');
--> statement-breakpoint
CREATE UNIQUE INDEX `scout_runs_legacy_backfill_source_idx` ON `scout_runs` (`source_run_id`) WHERE run_type='legacy_backfill';
--> statement-breakpoint
CREATE UNIQUE INDEX `scout_runs_position_backfill_fingerprint_idx` ON `scout_runs` (`request_fingerprint`) WHERE run_type='position_backfill';
--> statement-breakpoint
CREATE TABLE `scout_position_backfill_items` (
 `run_id` text NOT NULL REFERENCES scout_runs(id),
 `position_id` text NOT NULL REFERENCES scout_positions(id),
 `observation_id` text NOT NULL REFERENCES scout_position_observations(id),
 `configuration_source_id` text NOT NULL REFERENCES scout_company_configuration_sources(id),
 `linked_gig_id` text REFERENCES gigs(id),
 `requested_at` text NOT NULL,
 PRIMARY KEY (`run_id`,`position_id`)
);
--> statement-breakpoint
CREATE INDEX `scout_position_backfill_items_position_idx` ON `scout_position_backfill_items` (`position_id`,`run_id`);
--> statement-breakpoint
CREATE TABLE `managed_document_versions_new` (
 `document_id` text NOT NULL REFERENCES managed_documents(id),
 `version` integer NOT NULL CHECK(version > 0),
 `parent_version` integer CHECK(parent_version IS NULL OR parent_version < version),
 `content` text NOT NULL,
 `content_hash` text NOT NULL,
 `change_id` text NOT NULL REFERENCES changes(id),
 `change_summary` text NOT NULL,
 `created_at` text NOT NULL,
 `created_by` text NOT NULL,
 `source_description` text CHECK(source_description IS NULL OR length(source_description) BETWEEN 1 AND 500),
 `source_provenance_json` text CHECK(source_provenance_json IS NULL OR (length(source_provenance_json) BETWEEN 2 AND 4000 AND json_valid(source_provenance_json) AND json_type(source_provenance_json)='object')),
 PRIMARY KEY (`document_id`,`version`)
);
--> statement-breakpoint
INSERT INTO `managed_document_versions_new` (
 `document_id`,`version`,`parent_version`,`content`,`content_hash`,`change_id`,
 `change_summary`,`created_at`,`created_by`,`source_description`,`source_provenance_json`
)
SELECT
 `document_id`,`version`,`parent_version`,`content`,`content_hash`,`change_id`,
 `change_summary`,`created_at`,`created_by`,NULL,NULL
FROM `managed_document_versions`;
--> statement-breakpoint
DROP TABLE `managed_document_versions`;
--> statement-breakpoint
ALTER TABLE `managed_document_versions_new` RENAME TO `managed_document_versions`;
--> statement-breakpoint
CREATE INDEX `managed_document_versions_change_idx` ON `managed_document_versions` (`change_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_job_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`external_job_id` text,
	`stage` text NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`status_summary` text NOT NULL,
	`last_activity` text NOT NULL,
	`next_action_description` text,
	`next_action_due` text,
	`fit_rating` text NOT NULL,
	`fit_summary` text,
	`pay_currency` text,
	`pay_minimum` integer,
	`pay_maximum` integer,
	`pay_period` text,
	`pay_notes` text,
	`source_url` text,
	`location` text,
	`work_arrangement` text,
	`posted_date` text,
	`business_unit_team` text,
	`recruiter_source` text,
	`bonus` text,
	`equity` text,
	`other_compensation` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`has_job_description` integer DEFAULT false NOT NULL,
	`has_interview_prep` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "job_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_job_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "company", "title", "external_job_id", "stage", COALESCE("outcome", 'pending'), "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at" FROM `job_history`;--> statement-breakpoint
DROP TABLE `job_history`;--> statement-breakpoint
ALTER TABLE `__new_job_history` RENAME TO `job_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `job_history_entity_idx` ON `job_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `job_history_change_idx` ON `job_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`external_job_id` text,
	`stage` text NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`status_summary` text NOT NULL,
	`last_activity` text NOT NULL,
	`next_action_description` text,
	`next_action_due` text,
	`fit_rating` text NOT NULL,
	`fit_summary` text,
	`pay_currency` text,
	`pay_minimum` integer,
	`pay_maximum` integer,
	`pay_period` text,
	`pay_notes` text,
	`source_url` text,
	`location` text,
	`work_arrangement` text,
	`posted_date` text,
	`business_unit_team` text,
	`recruiter_source` text,
	`bonus` text,
	`equity` text,
	`other_compensation` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`has_job_description` integer DEFAULT false NOT NULL,
	`has_interview_prep` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "jobs_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "company", "title", "external_job_id", "stage", COALESCE("outcome", 'pending'), "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_stage_idx` ON `jobs` (`stage`);--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `jobs_deleted_idx` ON `jobs` (`is_deleted`);

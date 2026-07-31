PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gig_history` (
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
	CONSTRAINT "gig_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "gig_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_gig_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at" FROM `job_history`;--> statement-breakpoint
DROP TABLE `job_history`;--> statement-breakpoint
ALTER TABLE `__new_gig_history` RENAME TO `gig_history`;--> statement-breakpoint
CREATE INDEX `gig_history_entity_idx` ON `gig_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `gig_history_change_idx` ON `gig_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `__new_gig_people` (
	`id` text PRIMARY KEY NOT NULL,
	`gig_id` text NOT NULL,
	`person_id` text NOT NULL,
	`relationship` text NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gig_people_deleted_check" CHECK("is_deleted" in (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_gig_people`("id", "gig_id", "person_id", "relationship", "notes", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "job_id", "person_id", "relationship", "notes", "revision", "is_deleted", "created_at", "updated_at" FROM `job_people`;--> statement-breakpoint
DROP TABLE `job_people`;--> statement-breakpoint
ALTER TABLE `__new_gig_people` RENAME TO `gig_people`;--> statement-breakpoint
CREATE UNIQUE INDEX `gig_people_relation_idx` ON `gig_people` (`gig_id`,`person_id`,`relationship`);--> statement-breakpoint
CREATE TABLE `__new_gig_people_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`gig_id` text NOT NULL,
	`person_id` text NOT NULL,
	`relationship` text NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gig_people_history_deleted_check" CHECK("is_deleted" in (0,1)),
	CONSTRAINT "gig_people_history_operation_check" CHECK("operation" in ('update','delete'))
);
--> statement-breakpoint
INSERT INTO `__new_gig_people_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "gig_id", "person_id", "relationship", "notes", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "job_id", "person_id", "relationship", "notes", "revision", "is_deleted", "created_at", "updated_at" FROM `job_people_history`;--> statement-breakpoint
DROP TABLE `job_people_history`;--> statement-breakpoint
ALTER TABLE `__new_gig_people_history` RENAME TO `gig_people_history`;--> statement-breakpoint
CREATE INDEX `gig_people_history_entity_idx` ON `gig_people_history` (`id`,`revision`);--> statement-breakpoint
CREATE TABLE `__new_gigs` (
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
	CONSTRAINT "gigs_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_gigs`("id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "location", "work_arrangement", "posted_date", "business_unit_team", "recruiter_source", "bonus", "equity", "other_compensation", "tags_json", "has_job_description", "has_interview_prep", "revision", "is_deleted", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_gigs` RENAME TO `gigs`;--> statement-breakpoint
CREATE INDEX `gigs_stage_idx` ON `gigs` (`stage`);--> statement-breakpoint
CREATE INDEX `gigs_due_idx` ON `gigs` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `gigs_deleted_idx` ON `gigs` (`is_deleted`);--> statement-breakpoint
CREATE TABLE `__new_managed_document_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`gig_id` text,
	`person_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `managed_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_document_links_target_check" CHECK(("gig_id" is not null and "person_id" is null) or ("gig_id" is null and "person_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_managed_document_links`("id", "document_id", "gig_id", "person_id") SELECT "id", "document_id", "job_id", "person_id" FROM `managed_document_links`;--> statement-breakpoint
DROP TABLE `managed_document_links`;--> statement-breakpoint
ALTER TABLE `__new_managed_document_links` RENAME TO `managed_document_links`;--> statement-breakpoint
CREATE INDEX `managed_document_links_document_idx` ON `managed_document_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_gig_idx` ON `managed_document_links` (`gig_id`);--> statement-breakpoint
CREATE INDEX `managed_document_links_person_idx` ON `managed_document_links` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_gig_unique` ON `managed_document_links` (`document_id`,`gig_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_document_links_person_unique` ON `managed_document_links` (`document_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `__new_meeting_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`timezone` text NOT NULL,
	`location` text,
	`description` text,
	`status` text NOT NULL,
	`gig_id` text,
	`external_calendar_id` text,
	`external_event_id` text,
	`legacy_related_entity_type` text,
	`legacy_related_entity_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "meeting_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_meeting_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "gig_id", "external_calendar_id", "external_event_id", "legacy_related_entity_type", "legacy_related_entity_id", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "job_id", "external_calendar_id", "external_event_id", "legacy_related_entity_type", "legacy_related_entity_id", "revision", "is_deleted", "created_at", "updated_at" FROM `meeting_history`;--> statement-breakpoint
DROP TABLE `meeting_history`;--> statement-breakpoint
ALTER TABLE `__new_meeting_history` RENAME TO `meeting_history`;--> statement-breakpoint
CREATE INDEX `meeting_history_entity_idx` ON `meeting_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `meeting_history_change_idx` ON `meeting_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `__new_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`timezone` text NOT NULL,
	`location` text,
	`description` text,
	`status` text NOT NULL,
	`gig_id` text,
	`external_calendar_id` text,
	`external_event_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meetings_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_meetings`("id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "gig_id", "external_calendar_id", "external_event_id", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "job_id", "external_calendar_id", "external_event_id", "revision", "is_deleted", "created_at", "updated_at" FROM `meetings`;--> statement-breakpoint
DROP TABLE `meetings`;--> statement-breakpoint
ALTER TABLE `__new_meetings` RENAME TO `meetings`;--> statement-breakpoint
CREATE INDEX `meetings_start_idx` ON `meetings` (`starts_at`);--> statement-breakpoint
CREATE INDEX `meetings_deleted_idx` ON `meetings` (`is_deleted`);--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_external_event_idx` ON `meetings` (`external_calendar_id`,`external_event_id`);--> statement-breakpoint
UPDATE `tasks` SET `related_entity_type` = 'gig' WHERE `related_entity_type` = 'job';--> statement-breakpoint
UPDATE `task_history` SET `related_entity_type` = 'gig' WHERE `related_entity_type` = 'job';--> statement-breakpoint
UPDATE `business_events` SET `entity_type` = 'gig' WHERE `entity_type` = 'job';--> statement-breakpoint
PRAGMA foreign_keys=ON;

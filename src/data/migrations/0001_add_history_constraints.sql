PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contact_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`title` text,
	`linkedin_profile_url` text,
	`profile_status` text NOT NULL,
	`connected_on` text,
	`relationship_type` text NOT NULL,
	`relationship_strength` text NOT NULL,
	`introduced_by` text,
	`relationship_notes` text,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`last_contacted` text,
	`last_contact_method` text,
	`last_contact_summary` text,
	`next_action` text,
	`next_action_due` text,
	`why_interesting` text,
	`notes_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`source_files_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "contact_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_contact_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "name", "company", "title", "linkedin_profile_url", "profile_status", "connected_on", "relationship_type", "relationship_strength", "introduced_by", "relationship_notes", "priority", "status", "last_contacted", "last_contact_method", "last_contact_summary", "next_action", "next_action_due", "why_interesting", "notes_json", "tags_json", "source_files_json", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "name", "company", "title", "linkedin_profile_url", "profile_status", "connected_on", "relationship_type", "relationship_strength", "introduced_by", "relationship_notes", "priority", "status", "last_contacted", "last_contact_method", "last_contact_summary", "next_action", "next_action_due", "why_interesting", "notes_json", "tags_json", "source_files_json", "revision", "is_deleted", "created_at", "updated_at" FROM `contact_history`;--> statement-breakpoint
DROP TABLE `contact_history`;--> statement-breakpoint
ALTER TABLE `__new_contact_history` RENAME TO `contact_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `contact_history_entity_idx` ON `contact_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `contact_history_change_idx` ON `contact_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `__new_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`title` text,
	`linkedin_profile_url` text,
	`profile_status` text NOT NULL,
	`connected_on` text,
	`relationship_type` text NOT NULL,
	`relationship_strength` text NOT NULL,
	`introduced_by` text,
	`relationship_notes` text,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`last_contacted` text,
	`last_contact_method` text,
	`last_contact_summary` text,
	`next_action` text,
	`next_action_due` text,
	`why_interesting` text,
	`notes_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`source_files_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "contacts_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_contacts`("id", "name", "company", "title", "linkedin_profile_url", "profile_status", "connected_on", "relationship_type", "relationship_strength", "introduced_by", "relationship_notes", "priority", "status", "last_contacted", "last_contact_method", "last_contact_summary", "next_action", "next_action_due", "why_interesting", "notes_json", "tags_json", "source_files_json", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "name", "company", "title", "linkedin_profile_url", "profile_status", "connected_on", "relationship_type", "relationship_strength", "introduced_by", "relationship_notes", "priority", "status", "last_contacted", "last_contact_method", "last_contact_summary", "next_action", "next_action_due", "why_interesting", "notes_json", "tags_json", "source_files_json", "revision", "is_deleted", "created_at", "updated_at" FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
CREATE INDEX `contacts_priority_idx` ON `contacts` (`priority`);--> statement-breakpoint
CREATE INDEX `contacts_status_idx` ON `contacts` (`status`);--> statement-breakpoint
CREATE INDEX `contacts_due_idx` ON `contacts` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `contacts_deleted_idx` ON `contacts` (`is_deleted`);--> statement-breakpoint
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
	`outcome` text,
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
	`role_directory` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "job_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_job_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "role_directory", "tags_json", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "role_directory", "tags_json", "revision", "is_deleted", "created_at", "updated_at" FROM `job_history`;--> statement-breakpoint
DROP TABLE `job_history`;--> statement-breakpoint
ALTER TABLE `__new_job_history` RENAME TO `job_history`;--> statement-breakpoint
CREATE INDEX `job_history_entity_idx` ON `job_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `job_history_change_idx` ON `job_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`external_job_id` text,
	`stage` text NOT NULL,
	`outcome` text,
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
	`role_directory` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "jobs_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "role_directory", "tags_json", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "company", "title", "external_job_id", "stage", "outcome", "status_summary", "last_activity", "next_action_description", "next_action_due", "fit_rating", "fit_summary", "pay_currency", "pay_minimum", "pay_maximum", "pay_period", "pay_notes", "source_url", "role_directory", "tags_json", "revision", "is_deleted", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_stage_idx` ON `jobs` (`stage`);--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `jobs_deleted_idx` ON `jobs` (`is_deleted`);--> statement-breakpoint
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
	`related_entity_type` text,
	`related_entity_id` text,
	`external_calendar_id` text,
	`external_event_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "meeting_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_meeting_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "related_entity_type", "related_entity_id", "external_calendar_id", "external_event_id", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "related_entity_type", "related_entity_id", "external_calendar_id", "external_event_id", "revision", "is_deleted", "created_at", "updated_at" FROM `meeting_history`;--> statement-breakpoint
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
	`related_entity_type` text,
	`related_entity_id` text,
	`external_calendar_id` text,
	`external_event_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "meetings_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_meetings`("id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "related_entity_type", "related_entity_id", "external_calendar_id", "external_event_id", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "title", "starts_at", "ends_at", "timezone", "location", "description", "status", "related_entity_type", "related_entity_id", "external_calendar_id", "external_event_id", "revision", "is_deleted", "created_at", "updated_at" FROM `meetings`;--> statement-breakpoint
DROP TABLE `meetings`;--> statement-breakpoint
ALTER TABLE `__new_meetings` RENAME TO `meetings`;--> statement-breakpoint
CREATE INDEX `meetings_start_idx` ON `meetings` (`starts_at`);--> statement-breakpoint
CREATE INDEX `meetings_deleted_idx` ON `meetings` (`is_deleted`);--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_external_event_idx` ON `meetings` (`external_calendar_id`,`external_event_id`);--> statement-breakpoint
CREATE TABLE `__new_task_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`due_date` text,
	`related_entity_type` text NOT NULL,
	`related_entity_id` text,
	`related_entity_label` text NOT NULL,
	`notes` text,
	`completed_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_history_is_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "task_history_operation_check" CHECK("operation" in ('update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_task_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "type", "status", "priority", "due_date", "related_entity_type", "related_entity_id", "related_entity_label", "notes", "completed_at", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "type", "status", "priority", "due_date", "related_entity_type", "related_entity_id", "related_entity_label", "notes", "completed_at", "revision", "is_deleted", "created_at", "updated_at" FROM `task_history`;--> statement-breakpoint
DROP TABLE `task_history`;--> statement-breakpoint
ALTER TABLE `__new_task_history` RENAME TO `task_history`;--> statement-breakpoint
CREATE INDEX `task_history_entity_idx` ON `task_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `task_history_change_idx` ON `task_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`due_date` text,
	`related_entity_type` text NOT NULL,
	`related_entity_id` text,
	`related_entity_label` text NOT NULL,
	`notes` text,
	`completed_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tasks_is_deleted_check" CHECK("is_deleted" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "title", "type", "status", "priority", "due_date", "related_entity_type", "related_entity_id", "related_entity_label", "notes", "completed_at", "revision", "is_deleted", "created_at", "updated_at") SELECT "id", "title", "type", "status", "priority", "due_date", "related_entity_type", "related_entity_id", "related_entity_label", "notes", "completed_at", "revision", "is_deleted", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_deleted_idx` ON `tasks` (`is_deleted`);
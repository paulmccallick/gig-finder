CREATE TABLE `business_events` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`summary` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`supersedes_event_id` text,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `business_events_entity_idx` ON `business_events` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `business_events_change_idx` ON `business_events` (`change_id`);--> statement-breakpoint
CREATE TABLE `changes` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`actor` text NOT NULL,
	`source` text NOT NULL,
	`summary` text NOT NULL,
	`parent_change_id` text,
	`status` text DEFAULT 'committed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contact_history` (
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
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contact_history_entity_idx` ON `contact_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `contact_history_change_idx` ON `contact_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
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
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_priority_idx` ON `contacts` (`priority`);--> statement-breakpoint
CREATE INDEX `contacts_status_idx` ON `contacts` (`status`);--> statement-breakpoint
CREATE INDEX `contacts_due_idx` ON `contacts` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `contacts_deleted_idx` ON `contacts` (`is_deleted`);--> statement-breakpoint
CREATE TABLE `event_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`source_system` text NOT NULL,
	`external_id` text,
	`source_timestamp` text,
	`source_uri` text,
	`imported_at` text NOT NULL,
	`content_hash` text,
	`excerpt` text,
	FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_sources_event_idx` ON `event_sources` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_sources_external_idx` ON `event_sources` (`source_system`,`external_id`);--> statement-breakpoint
CREATE TABLE `job_history` (
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
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_history_entity_idx` ON `job_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `job_history_change_idx` ON `job_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
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
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_stage_idx` ON `jobs` (`stage`);--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `jobs_deleted_idx` ON `jobs` (`is_deleted`);--> statement-breakpoint
CREATE TABLE `meeting_history` (
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
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meeting_history_entity_idx` ON `meeting_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `meeting_history_change_idx` ON `meeting_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
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
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meetings_start_idx` ON `meetings` (`starts_at`);--> statement-breakpoint
CREATE INDEX `meetings_deleted_idx` ON `meetings` (`is_deleted`);--> statement-breakpoint
CREATE UNIQUE INDEX `meetings_external_event_idx` ON `meetings` (`external_calendar_id`,`external_event_id`);--> statement-breakpoint
CREATE TABLE `task_history` (
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
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_history_entity_idx` ON `task_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `task_history_change_idx` ON `task_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
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
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_deleted_idx` ON `tasks` (`is_deleted`);
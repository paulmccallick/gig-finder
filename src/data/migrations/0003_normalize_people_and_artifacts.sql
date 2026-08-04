CREATE TABLE `job_people` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`person_id` text NOT NULL,
	`relationship` text NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_people_deleted_check" CHECK("job_people"."is_deleted" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_people_relation_idx` ON `job_people` (`job_id`,`person_id`,`relationship`);--> statement-breakpoint
CREATE TABLE `job_people_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`person_id` text NOT NULL,
	`relationship` text NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_people_history_deleted_check" CHECK("job_people_history"."is_deleted" in (0,1)),
	CONSTRAINT "job_people_history_operation_check" CHECK("job_people_history"."operation" in ('update','delete'))
);
--> statement-breakpoint
CREATE INDEX `job_people_history_entity_idx` ON `job_people_history` (`id`,`revision`);--> statement-breakpoint
CREATE TABLE `networking_contact_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`person_id` text NOT NULL,
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
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "networking_history_deleted_check" CHECK("networking_contact_history"."is_deleted" in (0,1)),
	CONSTRAINT "networking_history_operation_check" CHECK("networking_contact_history"."operation" in ('update','delete'))
);
--> statement-breakpoint
CREATE INDEX `networking_history_entity_idx` ON `networking_contact_history` (`id`,`revision`);--> statement-breakpoint
CREATE TABLE `networking_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
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
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "networking_deleted_check" CHECK("networking_contacts"."is_deleted" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `networking_person_idx` ON `networking_contacts` (`person_id`);--> statement-breakpoint
CREATE INDEX `networking_priority_idx` ON `networking_contacts` (`priority`);--> statement-breakpoint
CREATE INDEX `networking_due_idx` ON `networking_contacts` (`next_action_due`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`title` text,
	`linkedin_profile_url` text,
	`connected_on` text,
	`has_local_profile` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "people_deleted_check" CHECK("people"."is_deleted" in (0,1))
);
--> statement-breakpoint
CREATE INDEX `people_name_idx` ON `people` (`name`);--> statement-breakpoint
CREATE TABLE `person_history` (
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
	`connected_on` text,
	`has_local_profile` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "person_history_deleted_check" CHECK("person_history"."is_deleted" in (0,1)),
	CONSTRAINT "person_history_operation_check" CHECK("person_history"."operation" in ('update','delete'))
);
--> statement-breakpoint
CREATE INDEX `person_history_entity_idx` ON `person_history` (`id`,`revision`);--> statement-breakpoint
INSERT INTO `people` (`id`,`name`,`company`,`title`,`linkedin_profile_url`,`connected_on`,`has_local_profile`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT `id`,`name`,`company`,`title`,`linkedin_profile_url`,`connected_on`,0,`revision`,`is_deleted`,`created_at`,`updated_at` FROM `contacts`;--> statement-breakpoint
INSERT INTO `person_history` (`change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`name`,`company`,`title`,`linkedin_profile_url`,`connected_on`,`has_local_profile`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT `change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`name`,`company`,`title`,`linkedin_profile_url`,`connected_on`,0,`revision`,`is_deleted`,`created_at`,`updated_at` FROM `contact_history`;--> statement-breakpoint
INSERT INTO `networking_contacts` (`id`,`person_id`,`relationship_type`,`relationship_strength`,`introduced_by`,`relationship_notes`,`priority`,`status`,`last_contacted`,`last_contact_method`,`last_contact_summary`,`next_action`,`next_action_due`,`why_interesting`,`notes_json`,`tags_json`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT `id`,`id`,`relationship_type`,`relationship_strength`,`introduced_by`,`relationship_notes`,`priority`,`status`,`last_contacted`,`last_contact_method`,`last_contact_summary`,`next_action`,`next_action_due`,`why_interesting`,`notes_json`,`tags_json`,`revision`,`is_deleted`,`created_at`,`updated_at` FROM `contacts`;--> statement-breakpoint
INSERT INTO `networking_contact_history` (`change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`person_id`,`relationship_type`,`relationship_strength`,`introduced_by`,`relationship_notes`,`priority`,`status`,`last_contacted`,`last_contact_method`,`last_contact_summary`,`next_action`,`next_action_due`,`why_interesting`,`notes_json`,`tags_json`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT `change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`id`,`relationship_type`,`relationship_strength`,`introduced_by`,`relationship_notes`,`priority`,`status`,`last_contacted`,`last_contact_method`,`last_contact_summary`,`next_action`,`next_action_due`,`why_interesting`,`notes_json`,`tags_json`,`revision`,`is_deleted`,`created_at`,`updated_at` FROM `contact_history`;--> statement-breakpoint
DROP TABLE `contact_history`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `job_history` ADD `has_job_description` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `job_history` ADD `has_interview_prep` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `has_job_description` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `has_interview_prep` integer DEFAULT false NOT NULL;

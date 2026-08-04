-- migrateDatabase preflights and populates this table before executing the
-- migration when a legacy database contains job-linked meetings.
CREATE TABLE IF NOT EXISTS `meeting_participant_backfill` (
	`meeting_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY (`meeting_id`, `person_id`)
);--> statement-breakpoint
INSERT OR IGNORE INTO `meeting_participant_backfill` (`meeting_id`, `person_id`)
SELECT `meetings`.`id`, `networking_contacts`.`person_id`
FROM `meetings`
JOIN `networking_contacts`
	ON `meetings`.`related_entity_type` = 'contact'
	AND `meetings`.`related_entity_id` = `networking_contacts`.`id`;--> statement-breakpoint
INSERT OR IGNORE INTO `meeting_participant_backfill` (`meeting_id`, `person_id`)
SELECT `meetings`.`id`, `people`.`id`
FROM `meetings`
JOIN `people`
	ON `meetings`.`related_entity_type` = 'person'
	AND `meetings`.`related_entity_id` = `people`.`id`;--> statement-breakpoint
ALTER TABLE `meeting_history` RENAME COLUMN "related_entity_type" TO "legacy_related_entity_type";--> statement-breakpoint
ALTER TABLE `meeting_history` RENAME COLUMN "related_entity_id" TO "legacy_related_entity_id";--> statement-breakpoint
CREATE TABLE `meeting_participant_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`person_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_participant_history_deleted_check" CHECK("meeting_participant_history"."is_deleted" in (0, 1)),
	CONSTRAINT "meeting_participant_history_operation_check" CHECK("meeting_participant_history"."operation" in ('update', 'delete'))
);
--> statement-breakpoint
CREATE INDEX `meeting_participant_history_entity_idx` ON `meeting_participant_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `meeting_participant_history_change_idx` ON `meeting_participant_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `meeting_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`person_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_participants_deleted_check" CHECK("meeting_participants"."is_deleted" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_participants_relation_idx` ON `meeting_participants` (`meeting_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `meeting_participants_meeting_idx` ON `meeting_participants` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `meeting_participants_person_idx` ON `meeting_participants` (`person_id`);--> statement-breakpoint
ALTER TABLE `meeting_history` ADD `job_id` text REFERENCES jobs(id);--> statement-breakpoint
UPDATE `meeting_history`
SET `job_id` = `legacy_related_entity_id`
WHERE `legacy_related_entity_type` = 'job'
	AND EXISTS (SELECT 1 FROM `jobs` WHERE `jobs`.`id` = `meeting_history`.`legacy_related_entity_id`);--> statement-breakpoint
ALTER TABLE `meetings` ADD `job_id` text REFERENCES jobs(id);--> statement-breakpoint
UPDATE `meetings`
SET `job_id` = `related_entity_id`
WHERE `related_entity_type` = 'job'
	AND EXISTS (SELECT 1 FROM `jobs` WHERE `jobs`.`id` = `meetings`.`related_entity_id`);--> statement-breakpoint
INSERT INTO `meeting_participants` (`id`, `meeting_id`, `person_id`, `revision`, `is_deleted`, `created_at`, `updated_at`)
SELECT 'meeting-participant:' || length(`meeting_participant_backfill`.`meeting_id`) || ':' ||
	`meeting_participant_backfill`.`meeting_id` || `meeting_participant_backfill`.`person_id`,
	`meeting_participant_backfill`.`meeting_id`,
	`meeting_participant_backfill`.`person_id`,
	1,
	`meetings`.`is_deleted`,
	`meetings`.`created_at`,
	`meetings`.`updated_at`
FROM `meeting_participant_backfill`
JOIN `meetings` ON `meetings`.`id` = `meeting_participant_backfill`.`meeting_id`
JOIN `people` ON `people`.`id` = `meeting_participant_backfill`.`person_id`;--> statement-breakpoint
CREATE TABLE `meeting_participant_migration_guard` (
	`missing_participants` integer NOT NULL CHECK (`missing_participants` = 0)
);--> statement-breakpoint
INSERT INTO `meeting_participant_migration_guard` (`missing_participants`)
SELECT count(*)
FROM `meetings`
WHERE NOT EXISTS (
		SELECT 1 FROM `meeting_participants`
		WHERE `meeting_participants`.`meeting_id` = `meetings`.`id`
	);--> statement-breakpoint
DROP TABLE `meeting_participant_migration_guard`;--> statement-breakpoint
ALTER TABLE `meetings` DROP COLUMN `related_entity_type`;--> statement-breakpoint
ALTER TABLE `meetings` DROP COLUMN `related_entity_id`;--> statement-breakpoint
DROP TABLE `meeting_participant_backfill`;

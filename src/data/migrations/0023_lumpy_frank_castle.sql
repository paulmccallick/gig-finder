CREATE TABLE IF NOT EXISTS `legacy_person_follow_up_archive` (
	`archive_id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`person_id` text NOT NULL,
	`source_history_id` integer,
	`source_change_id` text,
	`source_operation` text,
	`source_revision` integer NOT NULL,
	`next_action` text,
	`next_action_due` text,
	`captured_at` text NOT NULL,
	CONSTRAINT "legacy_person_follow_up_archive_source_check" CHECK("legacy_person_follow_up_archive"."source_kind" in ('current','history'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_person_follow_up_archive_person_idx` ON `legacy_person_follow_up_archive` (`person_id`,`source_revision`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `legacy_person_follow_up_archive_no_update` BEFORE UPDATE ON `legacy_person_follow_up_archive` BEGIN SELECT RAISE(ABORT, 'legacy Person follow-up archive is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `legacy_person_follow_up_archive_no_delete` BEFORE DELETE ON `legacy_person_follow_up_archive` BEGIN SELECT RAISE(ABORT, 'legacy Person follow-up archive is immutable'); END;

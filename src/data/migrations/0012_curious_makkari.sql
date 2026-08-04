PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meeting_participant_history` (
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
	CONSTRAINT "meeting_participant_history_deleted_check" CHECK("is_deleted" in (0, 1)),
	CONSTRAINT "meeting_participant_history_operation_check" CHECK("operation" in ('create', 'update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_meeting_participant_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "meeting_id", "person_id", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "meeting_id", "person_id", "revision", "is_deleted", "created_at", "updated_at" FROM `meeting_participant_history`;--> statement-breakpoint
DROP TABLE `meeting_participant_history`;--> statement-breakpoint
ALTER TABLE `__new_meeting_participant_history` RENAME TO `meeting_participant_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `meeting_participant_history_entity_idx` ON `meeting_participant_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `meeting_participant_history_change_idx` ON `meeting_participant_history` (`change_id`);

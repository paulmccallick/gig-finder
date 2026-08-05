PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "gig_people_history_operation_check" CHECK("operation" in ('create','update','delete'))
);
--> statement-breakpoint
INSERT INTO `__new_gig_people_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "gig_id", "person_id", "relationship", "notes", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "gig_id", "person_id", "relationship", "notes", "revision", "is_deleted", "created_at", "updated_at" FROM `gig_people_history`;--> statement-breakpoint
DROP TABLE `gig_people_history`;--> statement-breakpoint
ALTER TABLE `__new_gig_people_history` RENAME TO `gig_people_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `gig_people_history_entity_idx` ON `gig_people_history` (`id`,`revision`);

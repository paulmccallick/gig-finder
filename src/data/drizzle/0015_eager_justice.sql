PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "task_history_operation_check" CHECK("operation" in ('create', 'update', 'delete'))
);
--> statement-breakpoint
INSERT INTO `__new_task_history`("history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "type", "status", "priority", "due_date", "related_entity_type", "related_entity_id", "related_entity_label", "notes", "completed_at", "revision", "is_deleted", "created_at", "updated_at") SELECT "history_id", "change_id", "operation", "recorded_at", "recorded_by", "id", "title", "type", "status", "priority", "due_date", "related_entity_type", "related_entity_id", "related_entity_label", "notes", "completed_at", "revision", "is_deleted", "created_at", "updated_at" FROM `task_history`;--> statement-breakpoint
DROP TABLE `task_history`;--> statement-breakpoint
ALTER TABLE `__new_task_history` RENAME TO `task_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_history_entity_idx` ON `task_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `task_history_change_idx` ON `task_history` (`change_id`);

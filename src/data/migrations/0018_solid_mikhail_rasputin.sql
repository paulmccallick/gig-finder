CREATE TABLE `conversation_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`last_active_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "conversation_history_deleted_check" CHECK("conversation_history"."is_deleted" in (0, 1)),
	CONSTRAINT "conversation_history_operation_check" CHECK("conversation_history"."operation" = 'update')
);
--> statement-breakpoint
CREATE INDEX `conversation_history_entity_idx` ON `conversation_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `conversation_history_change_idx` ON `conversation_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`message_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_messages_sequence_idx` ON `conversation_messages` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `conversation_messages_conversation_idx` ON `conversation_messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`last_active_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "conversations_deleted_check" CHECK("conversations"."is_deleted" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `conversations_last_active_idx` ON `conversations` (`last_active_at`);
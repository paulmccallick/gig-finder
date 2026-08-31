CREATE TABLE `scout_description_acquisitions` (
	`processing_id` text PRIMARY KEY NOT NULL,
	`description_id` text NOT NULL,
	`source_url` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`source_content_hash` text NOT NULL,
	`extracted_content_hash` text NOT NULL,
	`source_key` text NOT NULL,
	`configuration_version` integer NOT NULL,
	`extraction_strategy` text NOT NULL,
	`converter_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`processing_id`) REFERENCES `scout_position_processing`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`description_id`) REFERENCES `scout_position_descriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scout_description_acquisitions_description_idx` ON `scout_description_acquisitions` (`description_id`,`processing_id`);
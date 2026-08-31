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
--> statement-breakpoint
UPDATE `scout_position_processing`
SET
	`description_id` = NULL,
	`attempt_count` = 0,
	`failure_code` = NULL,
	`failure_message` = NULL,
	`document_projection_status` = NULL,
	`completed_at` = NULL
WHERE `stage` = 'acquire_description'
	AND `status` = 'pending'
	AND `description_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `scout_description_acquisitions` acquisition
		WHERE acquisition.`processing_id` = `scout_position_processing`.`id`
	)
	AND EXISTS (
		SELECT 1
		FROM `scout_position_backfill_items` item
		JOIN `scout_runs` run
			ON run.`id` = item.`run_id`
			AND run.`run_type` = 'position_backfill'
		JOIN `scout_position_promotions` promotion
			ON promotion.`position_id` = item.`position_id`
			AND promotion.`gig_id` = item.`linked_gig_id`
			AND promotion.`status` = 'completed'
			AND promotion.`managed_document_id` IS NOT NULL
		WHERE item.`run_id` = `scout_position_processing`.`run_id`
			AND item.`position_id` = `scout_position_processing`.`position_id`
	);

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scout_position_backfill_items` (
	`run_id` text NOT NULL,
	`position_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`configuration_source_id` text NOT NULL,
	`linked_gig_id` text,
	`company_name` text,
	`template_name` text,
	`initial_state` text,
	`initial_decision_origin` text,
	`description_outcome` text,
	`final_outcome` text,
	`failure_code` text,
	`requested_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`run_id`, `position_id`),
	FOREIGN KEY (`run_id`) REFERENCES `scout_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_id`) REFERENCES `scout_positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_id`) REFERENCES `scout_position_observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`configuration_source_id`) REFERENCES `scout_company_configuration_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scout_position_backfill_items_description_outcome_check" CHECK("description_outcome" is null or "description_outcome" in ('corrected','unchanged')),
	CONSTRAINT "scout_position_backfill_items_final_outcome_check" CHECK("final_outcome" is null or "final_outcome" in ('agent_irrelevant','agent_irrelevant_to_review','needs_user_review','promoted','user_workflow_preserved','failed','unavailable','superseded'))
);
--> statement-breakpoint
INSERT INTO `__new_scout_position_backfill_items`("run_id", "position_id", "observation_id", "configuration_source_id", "linked_gig_id", "company_name", "template_name", "initial_state", "initial_decision_origin", "description_outcome", "final_outcome", "failure_code", "requested_at", "completed_at") SELECT "run_id", "position_id", "observation_id", "configuration_source_id", "linked_gig_id", NULL, NULL, NULL, NULL, NULL, NULL, NULL, "requested_at", NULL FROM `scout_position_backfill_items`;--> statement-breakpoint
DROP TABLE `scout_position_backfill_items`;--> statement-breakpoint
ALTER TABLE `__new_scout_position_backfill_items` RENAME TO `scout_position_backfill_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scout_position_backfill_items_position_idx` ON `scout_position_backfill_items` (`position_id`,`run_id`);

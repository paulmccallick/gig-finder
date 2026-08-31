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
CREATE INDEX `scout_position_backfill_items_position_idx` ON `scout_position_backfill_items` (`position_id`,`run_id`);--> statement-breakpoint
UPDATE `scout_position_backfill_items`
SET
	`company_name` = (
		SELECT company.`name`
		FROM `scout_positions` position
		JOIN `scout_companies` company ON company.`id` = position.`company_id`
		WHERE position.`id` = `scout_position_backfill_items`.`position_id`
	),
	`template_name` = (
		SELECT CASE
			WHEN json_type(source.`settings_json`, '$.template.id') = 'text'
				AND json_type(source.`settings_json`, '$.template.version') = 'integer'
			THEN json_extract(source.`settings_json`, '$.template.id') || '@' || json_extract(source.`settings_json`, '$.template.version')
			ELSE 'custom'
		END
		FROM `scout_company_configuration_sources` source
		WHERE source.`id` = `scout_position_backfill_items`.`configuration_source_id`
	),
	`initial_state` = coalesce((
		SELECT state.`state`
		FROM `scout_position_states` state
		WHERE state.`position_id` = `scout_position_backfill_items`.`position_id`
	), 'processing'),
	`initial_decision_origin` = (
		SELECT decision.`origin`
		FROM `scout_position_states` state
		JOIN `scout_position_decisions` decision ON decision.`id` = state.`current_decision_id`
		WHERE state.`position_id` = `scout_position_backfill_items`.`position_id`
	);--> statement-breakpoint
UPDATE `scout_position_backfill_items`
SET
	`final_outcome` = CASE
		WHEN EXISTS (
			SELECT 1 FROM `scout_position_processing` processing
			WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
				AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
				AND processing.`status` = 'failed'
		) THEN CASE
			WHEN EXISTS (
				SELECT 1 FROM `scout_position_processing` processing
				WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
					AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
					AND processing.`stage` = 'acquire_description'
					AND processing.`failure_code` IN ('description_http_404', 'description_http_410')
			) THEN 'unavailable'
			ELSE 'failed'
		END
		WHEN `linked_gig_id` IS NOT NULL THEN 'promoted'
		WHEN `initial_decision_origin` = 'user' THEN 'user_workflow_preserved'
		WHEN `initial_state` = 'irrelevant' THEN 'agent_irrelevant'
		WHEN `initial_state` = 'needs_user_review' THEN 'needs_user_review'
		WHEN NOT EXISTS (
			SELECT 1 FROM `scout_position_processing` processing
			WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
				AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
				AND processing.`status` <> 'superseded'
		) THEN 'superseded'
		ELSE 'failed'
	END,
	`failure_code` = CASE
		WHEN EXISTS (
			SELECT 1 FROM `scout_position_processing` processing
			WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
				AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
				AND processing.`status` = 'failed'
		) THEN (
			SELECT coalesce(processing.`failure_code`, 'legacy_processing_failed')
			FROM `scout_position_processing` processing
			WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
				AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
				AND processing.`status` = 'failed'
			ORDER BY coalesce(processing.`completed_at`, processing.`updated_at`) DESC, processing.`id` DESC
			LIMIT 1
		)
		WHEN `linked_gig_id` IS NULL
			AND coalesce(`initial_decision_origin`, '') <> 'user'
			AND `initial_state` NOT IN ('irrelevant', 'needs_user_review')
			AND EXISTS (
				SELECT 1 FROM `scout_position_processing` processing
				WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
					AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
					AND processing.`status` <> 'superseded'
			) THEN 'legacy_outcome_unresolved'
		ELSE NULL
	END,
	`completed_at` = coalesce((
		SELECT max(coalesce(processing.`completed_at`, processing.`updated_at`))
		FROM `scout_position_processing` processing
		WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
			AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
	), `requested_at`)
WHERE EXISTS (
		SELECT 1 FROM `scout_position_processing` processing
		WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
			AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
	)
	AND NOT EXISTS (
		SELECT 1 FROM `scout_position_processing` processing
		WHERE processing.`run_id` = `scout_position_backfill_items`.`run_id`
			AND processing.`position_id` = `scout_position_backfill_items`.`position_id`
			AND processing.`status` = 'pending'
	);--> statement-breakpoint
UPDATE `scout_runs`
SET
	`status` = CASE
		WHEN NOT EXISTS (
			SELECT 1 FROM `scout_position_backfill_items` item
			WHERE item.`run_id` = `scout_runs`.`id`
				AND item.`final_outcome` IS NULL
		) THEN CASE
			WHEN NOT EXISTS (
				SELECT 1 FROM `scout_position_backfill_items` item
				WHERE item.`run_id` = `scout_runs`.`id`
					AND item.`final_outcome` NOT IN ('failed', 'unavailable')
			) THEN 'failed'
			WHEN EXISTS (
				SELECT 1 FROM `scout_position_backfill_items` item
				WHERE item.`run_id` = `scout_runs`.`id`
					AND item.`final_outcome` IN ('failed', 'unavailable', 'superseded')
			) THEN 'partial'
			ELSE 'completed'
		END
		ELSE 'running'
	END,
	`completed_at` = CASE
		WHEN EXISTS (
			SELECT 1 FROM `scout_position_backfill_items` item
			WHERE item.`run_id` = `scout_runs`.`id`
				AND item.`final_outcome` IS NULL
		) THEN NULL
		ELSE (
			SELECT max(item.`completed_at`)
			FROM `scout_position_backfill_items` item
			WHERE item.`run_id` = `scout_runs`.`id`
		)
	END
WHERE `run_type` = 'position_backfill'
	AND EXISTS (
		SELECT 1 FROM `scout_position_backfill_items` item
		WHERE item.`run_id` = `scout_runs`.`id`
	);

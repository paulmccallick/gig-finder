UPDATE `scout_position_states`
SET
	`state` = 'needs_user_review',
	`linked_gig_id` = NULL,
	`deferred_until` = NULL,
	`updated_at` = (
		SELECT promotion.`updated_at`
		FROM `scout_position_promotions` promotion
		WHERE promotion.`position_id` = `scout_position_states`.`position_id`
			AND promotion.`status` IN ('pending', 'failed')
	)
WHERE EXISTS (
	SELECT 1
	FROM `scout_position_promotions` promotion
	WHERE promotion.`position_id` = `scout_position_states`.`position_id`
		AND promotion.`status` IN ('pending', 'failed')
);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scout_position_promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`position_id` text NOT NULL,
	`description_id` text NOT NULL,
	`observation_id` text,
	`resolution_kind` text,
	`requested_gig_id` text,
	`expected_gig_revision` integer,
	`resolution_fingerprint` text,
	`gig_id` text,
	`managed_document_id` text,
	`status` text NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`decision_id`) REFERENCES `scout_position_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_id`) REFERENCES `scout_positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`description_id`) REFERENCES `scout_position_descriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_id`) REFERENCES `scout_position_observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`managed_document_id`) REFERENCES `managed_documents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scout_position_promotions_status_check" CHECK("status" in ('pending','completed','failed')),
	CONSTRAINT "scout_position_promotions_resolution_check" CHECK(
    ("resolution_kind" is null and "requested_gig_id" is null and "expected_gig_revision" is null and "resolution_fingerprint" is null)
    or ("resolution_kind"='create_new' and "requested_gig_id" is null and "expected_gig_revision" is null and length("resolution_fingerprint")=64 and "resolution_fingerprint" not glob '*[^0-9a-f]*')
    or ("resolution_kind"='use_existing' and length(trim("requested_gig_id"))>0 and "expected_gig_revision">0 and length("resolution_fingerprint")=64 and "resolution_fingerprint" not glob '*[^0-9a-f]*')
  ),
	CONSTRAINT "scout_position_promotions_review_check" CHECK("status"='completed' or ("observation_id" is not null and "resolution_kind" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_scout_position_promotions`("id", "decision_id", "position_id", "description_id", "observation_id", "resolution_kind", "requested_gig_id", "expected_gig_revision", "resolution_fingerprint", "gig_id", "managed_document_id", "status", "failure_code", "failure_message", "attempt_count", "created_at", "updated_at", "completed_at")
SELECT "id", "decision_id", "position_id", "description_id", NULL, NULL, NULL, NULL, NULL, "gig_id", "managed_document_id", "status", "failure_code", "failure_message", "attempt_count", "created_at", "updated_at", "completed_at"
FROM `scout_position_promotions`
WHERE `status` = 'completed';--> statement-breakpoint
DROP TABLE `scout_position_promotions`;--> statement-breakpoint
ALTER TABLE `__new_scout_position_promotions` RENAME TO `scout_position_promotions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `scout_position_promotions_decision_id_unique` ON `scout_position_promotions` (`decision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scout_position_promotions_position_id_unique` ON `scout_position_promotions` (`position_id`);

DROP INDEX `scout_position_promotions_position_id_unique`;--> statement-breakpoint
CREATE INDEX `scout_position_promotions_position_idx` ON `scout_position_promotions` (`position_id`,`created_at`);
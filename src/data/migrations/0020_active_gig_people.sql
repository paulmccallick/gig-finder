DROP INDEX `gig_people_relation_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `gig_people_relation_idx` ON `gig_people` (`gig_id`,`person_id`,`relationship`) WHERE `is_deleted` = 0;
--> statement-breakpoint
CREATE TABLE `creation_idempotency` (
  `change_id` text PRIMARY KEY NOT NULL REFERENCES `changes`(`id`),
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `payload_hash` text NOT NULL
);

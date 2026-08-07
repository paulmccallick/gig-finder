CREATE TABLE IF NOT EXISTS `legacy_person_follow_up_archive` (
  `archive_id` text PRIMARY KEY NOT NULL,
  `source_kind` text NOT NULL,
  `person_id` text NOT NULL,
  `source_history_id` integer,
  `source_change_id` text,
  `source_operation` text,
  `source_revision` integer NOT NULL,
  `next_action` text,
  `next_action_due` text,
  `captured_at` text NOT NULL,
  CONSTRAINT "legacy_person_follow_up_archive_source_check" CHECK (`source_kind` in ('current','history'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_person_follow_up_archive_person_idx` ON `legacy_person_follow_up_archive` (`person_id`,`source_revision`);--> statement-breakpoint
INSERT OR IGNORE INTO `legacy_person_follow_up_archive` (`archive_id`,`source_kind`,`person_id`,`source_history_id`,`source_change_id`,`source_operation`,`source_revision`,`next_action`,`next_action_due`,`captured_at`)
SELECT 'current:' || p.`id`, 'current', p.`id`, NULL, NULL, NULL, p.`revision`, p.`next_action`, p.`next_action_due`, p.`updated_at`
FROM `people` p
WHERE p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `legacy_person_follow_up_archive` (`archive_id`,`source_kind`,`person_id`,`source_history_id`,`source_change_id`,`source_operation`,`source_revision`,`next_action`,`next_action_due`,`captured_at`)
SELECT 'history:' || h.`history_id`, 'history', h.`id`, h.`history_id`, h.`change_id`, h.`operation`, h.`revision`, h.`next_action`, h.`next_action_due`, h.`recorded_at`
FROM `person_history` h
WHERE h.`next_action` IS NOT NULL OR h.`next_action_due` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `legacy_person_follow_up_archive_no_update` BEFORE UPDATE ON `legacy_person_follow_up_archive` BEGIN SELECT RAISE(ABORT, 'legacy Person follow-up archive is immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `legacy_person_follow_up_archive_no_delete` BEFORE DELETE ON `legacy_person_follow_up_archive` BEGIN SELECT RAISE(ABORT, 'legacy Person follow-up archive is immutable'); END;--> statement-breakpoint
CREATE TABLE `__person_follow_up_migration_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));--> statement-breakpoint
INSERT INTO `__person_follow_up_migration_guard` (`ok`)
SELECT 0 FROM `people` p
JOIN `tasks` t ON t.`id` = 'migration:0022:person-follow-up:' || p.`id`
WHERE p.`is_deleted` = 0
  AND (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND NOT (
    t.`title` = COALESCE(p.`next_action`, 'Follow up with ' || p.`name`)
    AND t.`type` = 'networking_follow_up'
    AND t.`status` IN ('open','in_progress')
    AND t.`priority` = CASE p.`priority` WHEN 'high' THEN 'high' WHEN 'low' THEN 'low' ELSE 'medium' END
    AND t.`due_date` IS p.`next_action_due`
    AND t.`related_entity_type` = 'person'
    AND t.`related_entity_id` = p.`id`
    AND t.`related_entity_label` = p.`name`
    AND t.`is_deleted` = 0
  );--> statement-breakpoint
INSERT INTO `__person_follow_up_migration_guard` (`ok`)
SELECT 0 FROM `people` p
JOIN `changes` c ON c.`id` = 'migration:0022:person-follow-up:' || p.`id`
WHERE p.`is_deleted` = 0
  AND (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND NOT (
    c.`occurred_at` = p.`updated_at`
    AND c.`actor` = 'migration-0022'
    AND c.`source` = 'automation'
    AND c.`summary` = 'Preserved legacy Person follow-up as a Task'
    AND c.`status` = 'committed'
  );--> statement-breakpoint
INSERT INTO `__person_follow_up_migration_guard` (`ok`)
SELECT 0 FROM `people` p
WHERE p.`is_deleted` = 0
  AND (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND (
    EXISTS (SELECT 1 FROM `tasks` t WHERE t.`id` = 'migration:0022:person-follow-up:' || p.`id`)
    OR EXISTS (SELECT 1 FROM `changes` c WHERE c.`id` = 'migration:0022:person-follow-up:' || p.`id`)
    OR EXISTS (SELECT 1 FROM `task_history` h WHERE h.`change_id` = 'migration:0022:person-follow-up:' || p.`id`)
  )
  AND NOT (
    EXISTS (
      SELECT 1 FROM `tasks` t
      WHERE t.`id` = 'migration:0022:person-follow-up:' || p.`id`
        AND t.`title` = COALESCE(p.`next_action`, 'Follow up with ' || p.`name`)
        AND t.`type` = 'networking_follow_up' AND t.`status` = 'open' AND t.`is_deleted` = 0
        AND t.`due_date` IS p.`next_action_due` AND t.`related_entity_type` = 'person'
        AND t.`related_entity_id` = p.`id` AND t.`related_entity_label` = p.`name`
    )
    AND EXISTS (
      SELECT 1 FROM `changes` c
      WHERE c.`id` = 'migration:0022:person-follow-up:' || p.`id`
        AND c.`occurred_at` = p.`updated_at` AND c.`actor` = 'migration-0022'
        AND c.`source` = 'automation' AND c.`summary` = 'Preserved legacy Person follow-up as a Task'
        AND c.`status` = 'committed'
    )
    AND EXISTS (
      SELECT 1 FROM `task_history` h
      WHERE h.`change_id` = 'migration:0022:person-follow-up:' || p.`id`
        AND h.`id` = 'migration:0022:person-follow-up:' || p.`id`
        AND h.`operation` = 'create' AND h.`recorded_by` = 'migration-0022'
        AND h.`recorded_at` = p.`updated_at`
        AND h.`title` = COALESCE(p.`next_action`, 'Follow up with ' || p.`name`)
        AND h.`type` = 'networking_follow_up' AND h.`status` = 'open' AND h.`is_deleted` = 0
        AND h.`priority` = CASE p.`priority` WHEN 'high' THEN 'high' WHEN 'low' THEN 'low' ELSE 'medium' END
        AND h.`due_date` IS p.`next_action_due` AND h.`related_entity_type` = 'person'
        AND h.`related_entity_id` = p.`id` AND h.`related_entity_label` = p.`name`
        AND h.`notes` IS NULL AND h.`completed_at` IS NULL AND h.`revision` = 1
        AND h.`created_at` = p.`updated_at` AND h.`updated_at` = p.`updated_at`
    )
  );--> statement-breakpoint
DROP TABLE `__person_follow_up_migration_guard`;--> statement-breakpoint
INSERT OR IGNORE INTO `changes` (`id`,`occurred_at`,`actor`,`source`,`summary`,`parent_change_id`,`status`)
SELECT 'migration:0022:person-follow-up:' || p.`id`, p.`updated_at`, 'migration-0022', 'automation', 'Preserved legacy Person follow-up as a Task', NULL, 'committed'
FROM `people` p
WHERE p.`is_deleted` = 0
  AND (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM `tasks` t
    WHERE t.`related_entity_type` = 'person'
      AND t.`related_entity_id` = p.`id`
      AND t.`type` = 'networking_follow_up'
      AND t.`status` IN ('open','in_progress')
      AND t.`is_deleted` = 0
      AND t.`title` = COALESCE(p.`next_action`, 'Follow up with ' || p.`name`)
      AND t.`due_date` IS p.`next_action_due`
  );--> statement-breakpoint
INSERT OR IGNORE INTO `tasks` (`id`,`title`,`type`,`status`,`priority`,`due_date`,`related_entity_type`,`related_entity_id`,`related_entity_label`,`notes`,`completed_at`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT 'migration:0022:person-follow-up:' || p.`id`, COALESCE(p.`next_action`, 'Follow up with ' || p.`name`), 'networking_follow_up', 'open',
  CASE p.`priority` WHEN 'high' THEN 'high' WHEN 'low' THEN 'low' ELSE 'medium' END,
  p.`next_action_due`, 'person', p.`id`, p.`name`, NULL, NULL, 1, 0, p.`updated_at`, p.`updated_at`
FROM `people` p
WHERE p.`is_deleted` = 0
  AND (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM `tasks` t
    WHERE t.`related_entity_type` = 'person'
      AND t.`related_entity_id` = p.`id`
      AND t.`type` = 'networking_follow_up'
      AND t.`status` IN ('open','in_progress')
      AND t.`is_deleted` = 0
      AND t.`title` = COALESCE(p.`next_action`, 'Follow up with ' || p.`name`)
      AND t.`due_date` IS p.`next_action_due`
  );--> statement-breakpoint
INSERT OR IGNORE INTO `task_history` (`change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`title`,`type`,`status`,`priority`,`due_date`,`related_entity_type`,`related_entity_id`,`related_entity_label`,`notes`,`completed_at`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT 'migration:0022:person-follow-up:' || p.`id`, 'create', p.`updated_at`, 'migration-0022', t.`id`, t.`title`, t.`type`, t.`status`, t.`priority`, t.`due_date`, t.`related_entity_type`, t.`related_entity_id`, t.`related_entity_label`, t.`notes`, t.`completed_at`, t.`revision`, t.`is_deleted`, t.`created_at`, t.`updated_at`
FROM `people` p
JOIN `tasks` t ON t.`id` = 'migration:0022:person-follow-up:' || p.`id`
JOIN `changes` c ON c.`id` = 'migration:0022:person-follow-up:' || p.`id`
  AND c.`actor` = 'migration-0022'
  AND c.`source` = 'automation'
  AND c.`summary` = 'Preserved legacy Person follow-up as a Task'
WHERE p.`is_deleted` = 0
  AND (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM `task_history` h
    WHERE h.`change_id` = 'migration:0022:person-follow-up:' || p.`id`
      AND h.`id` = t.`id`
      AND h.`operation` = 'create'
  );--> statement-breakpoint
DROP INDEX `people_due_idx`;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `next_action`;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `next_action_due`;--> statement-breakpoint
ALTER TABLE `person_history` DROP COLUMN `next_action`;--> statement-breakpoint
ALTER TABLE `person_history` DROP COLUMN `next_action_due`;

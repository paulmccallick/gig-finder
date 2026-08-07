CREATE TABLE `__person_follow_up_migration_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));--> statement-breakpoint
INSERT INTO `__person_follow_up_migration_guard` (`ok`)
SELECT 0 FROM `people` p
JOIN `tasks` t ON t.`id` = 'migration:0022:person-follow-up:' || p.`id`
WHERE (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
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
WHERE (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
  AND NOT (
    c.`occurred_at` = p.`updated_at`
    AND c.`actor` = 'migration-0022'
    AND c.`source` = 'automation'
    AND c.`summary` = 'Preserved legacy Person follow-up as a Task'
    AND c.`status` = 'committed'
  );--> statement-breakpoint
DROP TABLE `__person_follow_up_migration_guard`;--> statement-breakpoint
INSERT OR IGNORE INTO `changes` (`id`,`occurred_at`,`actor`,`source`,`summary`,`parent_change_id`,`status`)
SELECT 'migration:0022:person-follow-up:' || p.`id`, p.`updated_at`, 'migration-0022', 'automation', 'Preserved legacy Person follow-up as a Task', NULL, 'committed'
FROM `people` p
WHERE (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
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
WHERE (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
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
WHERE (p.`next_action` IS NOT NULL OR p.`next_action_due` IS NOT NULL)
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

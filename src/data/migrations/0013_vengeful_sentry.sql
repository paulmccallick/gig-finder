CREATE TEMP TABLE `__person_change_events` AS
SELECT
  source.person_id,
  source.change_id,
  MIN(source.recorded_at) AS recorded_at,
  MIN(source.recorded_by) AS recorded_by,
  CASE WHEN MAX(source.is_delete) = 1 THEN 'delete' ELSE 'update' END AS operation,
  changes.rowid AS change_order
FROM (
  SELECT id AS person_id, change_id, recorded_at, recorded_by,
    CASE WHEN operation = 'delete' THEN 1 ELSE 0 END AS is_delete
  FROM person_history
  UNION ALL
  SELECT person_id, change_id, recorded_at, recorded_by,
    CASE WHEN operation = 'delete' THEN 1 ELSE 0 END AS is_delete
  FROM networking_contact_history
) source
JOIN changes ON changes.id = source.change_id
GROUP BY source.person_id, source.change_id, changes.rowid;
--> statement-breakpoint
ALTER TABLE `people` ADD `relationship_type` text DEFAULT 'professional_contact' NOT NULL;
--> statement-breakpoint
ALTER TABLE `people` ADD `relationship_strength` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `people` ADD `introduced_by` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `relationship_notes` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `priority` text DEFAULT 'unranked' NOT NULL;
--> statement-breakpoint
ALTER TABLE `people` ADD `status` text DEFAULT 'not_contacted' NOT NULL;
--> statement-breakpoint
ALTER TABLE `people` ADD `last_contacted` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `last_contact_method` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `last_contact_summary` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `next_action` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `next_action_due` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `why_interesting` text;
--> statement-breakpoint
ALTER TABLE `people` ADD `notes_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `people` ADD `tags_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE people
SET
  relationship_type = COALESCE((SELECT relationship_type FROM networking_contacts WHERE person_id = people.id), 'professional_contact'),
  relationship_strength = COALESCE((SELECT relationship_strength FROM networking_contacts WHERE person_id = people.id), 'unknown'),
  introduced_by = (SELECT introduced_by FROM networking_contacts WHERE person_id = people.id),
  relationship_notes = (SELECT relationship_notes FROM networking_contacts WHERE person_id = people.id),
  priority = COALESCE((SELECT priority FROM networking_contacts WHERE person_id = people.id), 'unranked'),
  status = COALESCE((SELECT status FROM networking_contacts WHERE person_id = people.id), 'not_contacted'),
  last_contacted = (SELECT last_contacted FROM networking_contacts WHERE person_id = people.id),
  last_contact_method = (SELECT last_contact_method FROM networking_contacts WHERE person_id = people.id),
  last_contact_summary = (SELECT last_contact_summary FROM networking_contacts WHERE person_id = people.id),
  next_action = (SELECT next_action FROM networking_contacts WHERE person_id = people.id),
  next_action_due = (SELECT next_action_due FROM networking_contacts WHERE person_id = people.id),
  why_interesting = (SELECT why_interesting FROM networking_contacts WHERE person_id = people.id),
  notes_json = COALESCE((SELECT notes_json FROM networking_contacts WHERE person_id = people.id), '[]'),
  tags_json = COALESCE((SELECT tags_json FROM networking_contacts WHERE person_id = people.id), '[]'),
  revision = 1 + (SELECT COUNT(*) FROM __person_change_events WHERE person_id = people.id),
  created_at = MIN(created_at, COALESCE((SELECT created_at FROM networking_contacts WHERE person_id = people.id), created_at)),
  updated_at = MAX(updated_at, COALESCE((SELECT updated_at FROM networking_contacts WHERE person_id = people.id), updated_at));
--> statement-breakpoint
CREATE TEMP TABLE `__merged_person_history_rows` AS
SELECT
  events.change_id,
  events.operation,
  events.recorded_at,
  events.recorded_by,
  events.person_id AS id,
  COALESCE(person_snapshot.name, people.name) AS name,
  CASE WHEN person_snapshot.history_id IS NULL THEN people.company ELSE person_snapshot.company END AS company,
  CASE WHEN person_snapshot.history_id IS NULL THEN people.title ELSE person_snapshot.title END AS title,
  CASE WHEN person_snapshot.history_id IS NULL THEN people.linkedin_profile_url ELSE person_snapshot.linkedin_profile_url END AS linkedin_profile_url,
  CASE WHEN person_snapshot.history_id IS NULL THEN people.connected_on ELSE person_snapshot.connected_on END AS connected_on,
  COALESCE(network_snapshot.relationship_type, network_live.relationship_type, 'professional_contact') AS relationship_type,
  COALESCE(network_snapshot.relationship_strength, network_live.relationship_strength, 'unknown') AS relationship_strength,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.introduced_by ELSE network_snapshot.introduced_by END AS introduced_by,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.relationship_notes ELSE network_snapshot.relationship_notes END AS relationship_notes,
  COALESCE(network_snapshot.priority, network_live.priority, 'unranked') AS priority,
  COALESCE(network_snapshot.status, network_live.status, 'not_contacted') AS status,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.last_contacted ELSE network_snapshot.last_contacted END AS last_contacted,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.last_contact_method ELSE network_snapshot.last_contact_method END AS last_contact_method,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.last_contact_summary ELSE network_snapshot.last_contact_summary END AS last_contact_summary,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.next_action ELSE network_snapshot.next_action END AS next_action,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.next_action_due ELSE network_snapshot.next_action_due END AS next_action_due,
  CASE WHEN network_snapshot.history_id IS NULL THEN network_live.why_interesting ELSE network_snapshot.why_interesting END AS why_interesting,
  COALESCE(network_snapshot.notes_json, network_live.notes_json, '[]') AS notes_json,
  COALESCE(network_snapshot.tags_json, network_live.tags_json, '[]') AS tags_json,
  ROW_NUMBER() OVER (PARTITION BY events.person_id ORDER BY events.change_order, events.change_id) AS revision,
  COALESCE(person_snapshot.is_deleted, people.is_deleted) AS is_deleted,
  MIN(people.created_at, COALESCE(network_live.created_at, people.created_at)) AS created_at,
  MAX(COALESCE(person_snapshot.updated_at, people.updated_at), COALESCE(network_snapshot.updated_at, network_live.updated_at, people.updated_at)) AS updated_at
FROM __person_change_events events
JOIN people ON people.id = events.person_id
LEFT JOIN person_history person_snapshot ON person_snapshot.history_id = (
  SELECT candidate.history_id
  FROM person_history candidate
  JOIN changes candidate_change ON candidate_change.id = candidate.change_id
  WHERE candidate.id = events.person_id AND candidate_change.rowid >= events.change_order
  ORDER BY candidate_change.rowid, candidate.history_id
  LIMIT 1
)
LEFT JOIN networking_contacts network_live ON network_live.person_id = events.person_id
LEFT JOIN networking_contact_history network_snapshot ON network_snapshot.history_id = (
  SELECT candidate.history_id
  FROM networking_contact_history candidate
  JOIN changes candidate_change ON candidate_change.id = candidate.change_id
  WHERE candidate.person_id = events.person_id AND candidate_change.rowid >= events.change_order
  ORDER BY candidate_change.rowid, candidate.history_id
  LIMIT 1
);
--> statement-breakpoint
CREATE TABLE `__new_person_history` (
  `history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `change_id` text NOT NULL,
  `operation` text NOT NULL,
  `recorded_at` text NOT NULL,
  `recorded_by` text NOT NULL,
  `id` text NOT NULL,
  `name` text NOT NULL,
  `company` text,
  `title` text,
  `linkedin_profile_url` text,
  `connected_on` text,
  `relationship_type` text DEFAULT 'professional_contact' NOT NULL,
  `relationship_strength` text DEFAULT 'unknown' NOT NULL,
  `introduced_by` text,
  `relationship_notes` text,
  `priority` text DEFAULT 'unranked' NOT NULL,
  `status` text DEFAULT 'not_contacted' NOT NULL,
  `last_contacted` text,
  `last_contact_method` text,
  `last_contact_summary` text,
  `next_action` text,
  `next_action_due` text,
  `why_interesting` text,
  `notes_json` text DEFAULT '[]' NOT NULL,
  `tags_json` text DEFAULT '[]' NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `is_deleted` integer DEFAULT false NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `person_history_deleted_check` CHECK(`is_deleted` in (0,1)),
  CONSTRAINT `person_history_operation_check` CHECK(`operation` in ('update','delete'))
);
--> statement-breakpoint
INSERT INTO `__new_person_history` (`change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`name`,`company`,`title`,`linkedin_profile_url`,`connected_on`,`relationship_type`,`relationship_strength`,`introduced_by`,`relationship_notes`,`priority`,`status`,`last_contacted`,`last_contact_method`,`last_contact_summary`,`next_action`,`next_action_due`,`why_interesting`,`notes_json`,`tags_json`,`revision`,`is_deleted`,`created_at`,`updated_at`)
SELECT `change_id`,`operation`,`recorded_at`,`recorded_by`,`id`,`name`,`company`,`title`,`linkedin_profile_url`,`connected_on`,`relationship_type`,`relationship_strength`,`introduced_by`,`relationship_notes`,`priority`,`status`,`last_contacted`,`last_contact_method`,`last_contact_summary`,`next_action`,`next_action_due`,`why_interesting`,`notes_json`,`tags_json`,`revision`,`is_deleted`,`created_at`,`updated_at`
FROM `__merged_person_history_rows`
ORDER BY id, revision;
--> statement-breakpoint
UPDATE tasks
SET related_entity_type = 'person',
    related_entity_id = COALESCE((SELECT person_id FROM networking_contacts WHERE id = tasks.related_entity_id), related_entity_id)
WHERE related_entity_type IN ('contact', 'networking');
--> statement-breakpoint
UPDATE task_history
SET related_entity_type = 'person',
    related_entity_id = COALESCE((SELECT person_id FROM networking_contacts WHERE id = task_history.related_entity_id), related_entity_id)
WHERE related_entity_type IN ('contact', 'networking');
--> statement-breakpoint
UPDATE business_events
SET entity_type = 'person',
    entity_id = COALESCE((SELECT person_id FROM networking_contacts WHERE id = business_events.entity_id), entity_id)
WHERE entity_type IN ('contact', 'networking');
--> statement-breakpoint
DROP TABLE `person_history`;
--> statement-breakpoint
ALTER TABLE `__new_person_history` RENAME TO `person_history`;
--> statement-breakpoint
CREATE INDEX `person_history_entity_idx` ON `person_history` (`id`,`revision`);
--> statement-breakpoint
CREATE INDEX `people_priority_idx` ON `people` (`priority`);
--> statement-breakpoint
CREATE INDEX `people_due_idx` ON `people` (`next_action_due`);
--> statement-breakpoint
DROP TABLE `networking_contact_history`;
--> statement-breakpoint
DROP TABLE `networking_contacts`;
--> statement-breakpoint
DROP TABLE `__person_change_events`;
--> statement-breakpoint
DROP TABLE `__merged_person_history_rows`;

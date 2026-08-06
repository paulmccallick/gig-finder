CREATE TABLE `interaction_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`timezone` text,
	`location` text,
	`summary` text,
	`notes` text,
	`gig_id` text,
	`supersedes_interaction_id` text,
	`origin_change_id` text,
	`structured_data_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interaction_history_deleted_check" CHECK("interaction_history"."is_deleted" in (0,1)),
	CONSTRAINT "interaction_history_operation_check" CHECK("interaction_history"."operation" in ('create','update','delete'))
);
--> statement-breakpoint
CREATE INDEX `interaction_history_entity_idx` ON `interaction_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `interaction_history_change_idx` ON `interaction_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `interaction_legacy_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`interaction_id` text NOT NULL,
	`legacy_type` text NOT NULL,
	`legacy_id` text NOT NULL,
	`legacy_revision` integer,
	`origin_change_id` text,
	FOREIGN KEY (`interaction_id`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interaction_legacy_refs_identity_idx` ON `interaction_legacy_refs` (`legacy_type`,`legacy_id`,`legacy_revision`);--> statement-breakpoint
CREATE TABLE `interaction_participant_history` (
	`history_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` text NOT NULL,
	`operation` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`id` text NOT NULL,
	`interaction_id` text NOT NULL,
	`person_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interaction_id`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interaction_participant_history_deleted_check" CHECK("interaction_participant_history"."is_deleted" in (0,1)),
	CONSTRAINT "interaction_participant_history_operation_check" CHECK("interaction_participant_history"."operation" in ('create','update','delete'))
);
--> statement-breakpoint
CREATE INDEX `interaction_participant_history_entity_idx` ON `interaction_participant_history` (`id`,`revision`);--> statement-breakpoint
CREATE INDEX `interaction_participant_history_change_idx` ON `interaction_participant_history` (`change_id`);--> statement-breakpoint
CREATE TABLE `interaction_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`interaction_id` text NOT NULL,
	`person_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`interaction_id`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interaction_participants_deleted_check" CHECK("interaction_participants"."is_deleted" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interaction_participants_relation_idx` ON `interaction_participants` (`interaction_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `interaction_participants_interaction_idx` ON `interaction_participants` (`interaction_id`);--> statement-breakpoint
CREATE INDEX `interaction_participants_person_idx` ON `interaction_participants` (`person_id`);--> statement-breakpoint
CREATE TABLE `interaction_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`interaction_id` text NOT NULL,
	`source_system` text NOT NULL,
	`external_id` text,
	`source_timestamp` text,
	`source_uri` text,
	`imported_at` text NOT NULL,
	`content_hash` text,
	`excerpt` text,
	`origin_change_id` text,
	FOREIGN KEY (`interaction_id`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `interaction_sources_interaction_idx` ON `interaction_sources` (`interaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `interaction_sources_identity_idx` ON `interaction_sources` (`source_system`,`external_id`);--> statement-breakpoint
CREATE TABLE `interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`timezone` text,
	`location` text,
	`summary` text,
	`notes` text,
	`gig_id` text,
	`supersedes_interaction_id` text,
	`origin_change_id` text,
	`structured_data_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_interaction_id`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interactions_deleted_check" CHECK("interactions"."is_deleted" in (0,1)),
	CONSTRAINT "interactions_time_check" CHECK("ends_at" is null or (julianday("ends_at") is not null and julianday("starts_at") is not null and julianday("ends_at") >= julianday("starts_at"))),
	CONSTRAINT "interactions_kind_check" CHECK("interactions"."kind" in ('message','call','meeting','interview','conversation','other')),
	CONSTRAINT "interactions_channel_check" CHECK("interactions"."channel" in ('email','linkedin','sms','chat','phone','video','in_person','other')),
	CONSTRAINT "interactions_direction_check" CHECK("interactions"."direction" in ('inbound','outbound','mutual','unknown')),
	CONSTRAINT "interactions_status_check" CHECK("interactions"."status" in ('planned','confirmed','completed','canceled','no_show')),
	CONSTRAINT "interactions_structured_data_check" CHECK(json_valid("interactions"."structured_data_json") and json_type("interactions"."structured_data_json") = 'object'),
	CONSTRAINT "interactions_supersedes_check" CHECK("interactions"."supersedes_interaction_id" is null or "interactions"."supersedes_interaction_id" <> "interactions"."id")
);
--> statement-breakpoint
CREATE INDEX `interactions_start_idx` ON `interactions` (`starts_at`);--> statement-breakpoint
CREATE INDEX `interactions_gig_idx` ON `interactions` (`gig_id`);--> statement-breakpoint
CREATE INDEX `interactions_deleted_idx` ON `interactions` (`is_deleted`);--> statement-breakpoint
INSERT INTO interactions (id,subject,kind,channel,direction,status,starts_at,ends_at,timezone,location,summary,notes,gig_id,supersedes_interaction_id,origin_change_id,structured_data_json,revision,is_deleted,created_at,updated_at)
SELECT 'interaction:meeting:'||id,title,'meeting',CASE WHEN lower(coalesce(location,'')) LIKE '%zoom%' OR lower(coalesce(location,'')) LIKE '%meet%' OR lower(coalesce(location,'')) LIKE '%video%' THEN 'video' WHEN location IS NOT NULL THEN 'in_person' ELSE 'other' END,'mutual',CASE status WHEN 'completed' THEN 'completed' ELSE 'confirmed' END,starts_at,ends_at,timezone,location,NULL,description,gig_id,NULL,NULL,json_object('legacyMeetingId',id),revision,is_deleted,created_at,updated_at FROM meetings;--> statement-breakpoint
INSERT INTO interaction_participants (id,interaction_id,person_id,revision,is_deleted,created_at,updated_at)
SELECT 'interaction-participant:'||length('interaction:meeting:'||meeting_id)||':'||'interaction:meeting:'||meeting_id||person_id,'interaction:meeting:'||meeting_id,person_id,revision,is_deleted,created_at,updated_at FROM meeting_participants;--> statement-breakpoint
INSERT INTO interaction_history (change_id,operation,recorded_at,recorded_by,id,subject,kind,channel,direction,status,starts_at,ends_at,timezone,location,summary,notes,gig_id,supersedes_interaction_id,origin_change_id,structured_data_json,revision,is_deleted,created_at,updated_at)
SELECT change_id,operation,recorded_at,recorded_by,'interaction:meeting:'||id,title,'meeting','other','mutual',CASE status WHEN 'completed' THEN 'completed' ELSE 'confirmed' END,starts_at,ends_at,timezone,location,NULL,description,gig_id,NULL,NULL,json_object('legacyMeetingId',id,'legacyRelatedEntityType',legacy_related_entity_type,'legacyRelatedEntityId',legacy_related_entity_id),revision,is_deleted,created_at,updated_at FROM meeting_history;--> statement-breakpoint
INSERT INTO interaction_participant_history (change_id,operation,recorded_at,recorded_by,id,interaction_id,person_id,revision,is_deleted,created_at,updated_at)
SELECT change_id,operation,recorded_at,recorded_by,'interaction-participant:'||length('interaction:meeting:'||meeting_id)||':'||'interaction:meeting:'||meeting_id||person_id,'interaction:meeting:'||meeting_id,person_id,revision,is_deleted,created_at,updated_at FROM meeting_participant_history;--> statement-breakpoint
INSERT INTO interaction_legacy_refs (id,interaction_id,legacy_type,legacy_id,legacy_revision,origin_change_id)
SELECT 'legacy-ref:meeting:'||id||':current','interaction:meeting:'||id,'meeting',id,revision,NULL FROM meetings;--> statement-breakpoint
INSERT INTO interaction_legacy_refs (id,interaction_id,legacy_type,legacy_id,legacy_revision,origin_change_id)
SELECT 'legacy-ref:meeting:'||id||':'||revision,'interaction:meeting:'||id,'meeting',id,revision,change_id FROM meeting_history;--> statement-breakpoint
INSERT INTO interaction_sources (id,interaction_id,source_system,external_id,source_timestamp,source_uri,imported_at,content_hash,excerpt,origin_change_id)
SELECT 'interaction-source:meeting:'||id,'interaction:meeting:'||id,'calendar',external_event_id,starts_at,NULL,updated_at,NULL,description,NULL FROM meetings WHERE external_calendar_id IS NOT NULL OR external_event_id IS NOT NULL;--> statement-breakpoint
INSERT INTO interactions (id,subject,kind,channel,direction,status,starts_at,ends_at,timezone,location,summary,notes,gig_id,supersedes_interaction_id,origin_change_id,structured_data_json,revision,is_deleted,created_at,updated_at)
SELECT 'interaction:business-event:'||b.id,CASE WHEN trim(b.summary)='' THEN b.type ELSE b.summary END,coalesce(m.kind,'other'),coalesce(m.channel,'other'),coalesce(m.direction,'unknown'),coalesce(m.status,'completed'),b.occurred_at,NULL,NULL,NULL,b.summary,NULL,CASE WHEN b.entity_type IN ('gig','job') AND EXISTS(SELECT 1 FROM gigs g WHERE g.id=b.entity_id AND g.is_deleted=0) THEN b.entity_id ELSE NULL END,CASE WHEN b.supersedes_event_id IS NULL OR EXISTS(SELECT 1 FROM interaction_event_review r WHERE r.event_id=b.supersedes_event_id AND r.outcome='not_an_interaction') THEN NULL ELSE 'interaction:business-event:'||b.supersedes_event_id END,b.change_id,json_object('legacyEventType',b.type,'legacyEntity',json_object('type',b.entity_type,'id',b.entity_id),'legacyData',json(b.data_json)),1,0,b.occurred_at,b.occurred_at FROM business_events b LEFT JOIN interaction_event_mapping m ON m.type=b.type WHERE NOT EXISTS(SELECT 1 FROM interaction_event_review r WHERE r.event_id=b.id AND r.outcome='not_an_interaction');--> statement-breakpoint
INSERT INTO interaction_participants (id,interaction_id,person_id,revision,is_deleted,created_at,updated_at)
SELECT 'interaction-participant:'||length('interaction:business-event:'||r.event_id)||':'||'interaction:business-event:'||r.event_id||r.person_id,'interaction:business-event:'||r.event_id,r.person_id,1,0,b.occurred_at,b.occurred_at FROM interaction_person_resolution r JOIN business_events b ON b.id=r.event_id WHERE NOT EXISTS(SELECT 1 FROM interaction_event_review v WHERE v.event_id=b.id AND v.outcome='not_an_interaction');--> statement-breakpoint
INSERT INTO interaction_legacy_refs (id,interaction_id,legacy_type,legacy_id,legacy_revision,origin_change_id)
SELECT 'legacy-ref:business-event:'||b.id,'interaction:business-event:'||b.id,'business_event',b.id,NULL,b.change_id FROM business_events b WHERE NOT EXISTS(SELECT 1 FROM interaction_event_review r WHERE r.event_id=b.id AND r.outcome='not_an_interaction');--> statement-breakpoint
INSERT INTO interaction_sources (id,interaction_id,source_system,external_id,source_timestamp,source_uri,imported_at,content_hash,excerpt,origin_change_id)
SELECT s.id,'interaction:business-event:'||s.event_id,s.source_system,s.external_id,s.source_timestamp,s.source_uri,s.imported_at,s.content_hash,s.excerpt,(SELECT change_id FROM business_events WHERE id=s.event_id) FROM event_sources s WHERE NOT EXISTS(SELECT 1 FROM interaction_event_review r WHERE r.event_id=s.event_id AND r.outcome='not_an_interaction');--> statement-breakpoint
INSERT INTO interactions (id,subject,kind,channel,direction,status,starts_at,ends_at,timezone,location,summary,notes,gig_id,supersedes_interaction_id,origin_change_id,structured_data_json,revision,is_deleted,created_at,updated_at)
SELECT 'interaction:person-last-contact:'||p.source_key,'Legacy contact: '||p.name,CASE WHEN lower(coalesce(p.last_contact_method,'')) IN ('email','linkedin','sms','chat') THEN 'message' WHEN lower(coalesce(p.last_contact_method,'')) IN ('phone','call','video') THEN 'call' WHEN lower(coalesce(p.last_contact_method,'')) IN ('meeting','in person','in_person') THEN 'meeting' ELSE 'other' END,CASE lower(coalesce(p.last_contact_method,'')) WHEN 'email' THEN 'email' WHEN 'linkedin' THEN 'linkedin' WHEN 'sms' THEN 'sms' WHEN 'chat' THEN 'chat' WHEN 'phone' THEN 'phone' WHEN 'call' THEN 'phone' WHEN 'video' THEN 'video' WHEN 'in person' THEN 'in_person' WHEN 'in_person' THEN 'in_person' ELSE 'other' END,'unknown','completed',p.last_contacted||'T12:00:00Z',NULL,NULL,NULL,p.last_contact_summary,NULL,NULL,NULL,p.origin_change_id,json_object('legacyLastContactMethod',p.last_contact_method,'legacyPersonRevision',p.revision),1,0,p.recorded_at,p.recorded_at FROM interaction_person_contacts p;--> statement-breakpoint
INSERT INTO interaction_participants (id,interaction_id,person_id,revision,is_deleted,created_at,updated_at)
SELECT 'interaction-participant:'||length('interaction:person-last-contact:'||p.source_key)||':'||'interaction:person-last-contact:'||p.source_key||p.person_id,'interaction:person-last-contact:'||p.source_key,p.person_id,1,0,p.recorded_at,p.recorded_at FROM interaction_person_contacts p;--> statement-breakpoint
INSERT INTO interaction_legacy_refs (id,interaction_id,legacy_type,legacy_id,legacy_revision,origin_change_id)
SELECT 'legacy-ref:person-last-contact:'||p.source_key,'interaction:person-last-contact:'||p.source_key,'person_last_contact',p.person_id,p.revision,p.origin_change_id FROM interaction_person_contacts p;--> statement-breakpoint
CREATE TEMP TABLE interaction_migration_gate (valid integer NOT NULL CHECK(valid=1));--> statement-breakpoint
INSERT INTO interaction_migration_gate(valid)
SELECT CASE WHEN
 (SELECT count(*) FROM interactions)=e.expected_interactions AND
 (SELECT count(*) FROM interaction_history)=e.meeting_history AND
 (SELECT count(*) FROM interaction_participant_history)=e.meeting_participant_history AND
 (SELECT count(*) FROM interaction_sources)=e.expected_sources AND
 (SELECT count(*) FROM interaction_legacy_refs WHERE legacy_type='business_event')=e.business_events AND
 (SELECT count(*) FROM interaction_legacy_refs WHERE legacy_type='meeting')=e.meetings+e.meeting_history AND
 (SELECT count(*) FROM interaction_participants WHERE interaction_id LIKE 'interaction:meeting:%')=e.meeting_participants AND
 (SELECT count(DISTINCT interaction_id) FROM interaction_participants WHERE interaction_id LIKE 'interaction:business-event:%')=e.business_events
 THEN 1 ELSE 0 END FROM interaction_migration_expected e;--> statement-breakpoint
DROP TABLE interaction_migration_gate;--> statement-breakpoint
DROP TABLE `business_events`;--> statement-breakpoint
DROP TABLE `event_sources`;--> statement-breakpoint
DROP TABLE `meeting_history`;--> statement-breakpoint
DROP TABLE `meeting_participant_history`;--> statement-breakpoint
DROP TABLE `meeting_participants`;--> statement-breakpoint
DROP TABLE `meetings`;--> statement-breakpoint
DROP TABLE `interaction_person_resolution`;--> statement-breakpoint
DROP TABLE `interaction_migration_expected`;--> statement-breakpoint
DROP TABLE `interaction_event_mapping`;--> statement-breakpoint
DROP TABLE `interaction_event_review`;--> statement-breakpoint
DROP TABLE `interaction_review_person`;--> statement-breakpoint
DROP INDEX `gig_people_relation_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `gig_people_relation_idx` ON `gig_people` (`gig_id`,`person_id`,`relationship`) WHERE "gig_people"."is_deleted" = 0;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `last_contacted`;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `last_contact_method`;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `last_contact_summary`;--> statement-breakpoint
ALTER TABLE `person_history` DROP COLUMN `last_contacted`;--> statement-breakpoint
ALTER TABLE `person_history` DROP COLUMN `last_contact_method`;--> statement-breakpoint
ALTER TABLE `person_history` DROP COLUMN `last_contact_summary`;

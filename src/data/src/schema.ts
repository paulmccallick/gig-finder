import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const recordMetadata = {
  revision: integer("revision").notNull().default(1),
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

const historyMetadata = {
  historyId: integer("history_id").primaryKey({ autoIncrement: true }),
  changeId: text("change_id").notNull().references(() => changes.id),
  operation: text("operation", { enum: ["create", "update", "delete"] }).notNull(),
  recordedAt: text("recorded_at").notNull(),
  recordedBy: text("recorded_by").notNull(),
};

export const changes = sqliteTable("changes", {
  id: text("id").primaryKey(),
  occurredAt: text("occurred_at").notNull(),
  actor: text("actor").notNull(),
  source: text("source").notNull(),
  summary: text("summary").notNull(),
  parentChangeId: text("parent_change_id"),
  status: text("status", { enum: ["committed"] }).notNull().default("committed"),
});

export const applicationSettings = sqliteTable("application_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const gigFields = {
  id: text("id").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  externalJobId: text("external_job_id"),
  stage: text("stage").notNull(),
  outcome: text("outcome").notNull().default("pending"),
  statusSummary: text("status_summary").notNull(),
  lastActivity: text("last_activity").notNull(),
  nextActionDescription: text("next_action_description"),
  nextActionDue: text("next_action_due"),
  fitRating: text("fit_rating").notNull(),
  fitSummary: text("fit_summary"),
  payCurrency: text("pay_currency"),
  payMinimum: integer("pay_minimum"),
  payMaximum: integer("pay_maximum"),
  payPeriod: text("pay_period"),
  payNotes: text("pay_notes"),
  sourceUrl: text("source_url"),
  location: text("location"),
  workArrangement: text("work_arrangement"),
  postedDate: text("posted_date"),
  businessUnitTeam: text("business_unit_team"),
  recruiterSource: text("recruiter_source"),
  bonus: text("bonus"),
  equity: text("equity"),
  otherCompensation: text("other_compensation"),
  tagsJson: text("tags_json").notNull().default("[]"),
  hasJobDescription: integer("has_job_description", { mode:"boolean" }).notNull().default(false),
  hasInterviewPrep: integer("has_interview_prep", { mode:"boolean" }).notNull().default(false),
};

export const gigs = sqliteTable("gigs", { ...gigFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("gigs_stage_idx").on(table.stage), index("gigs_due_idx").on(table.nextActionDue), index("gigs_deleted_idx").on(table.isDeleted), check("gigs_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const gigHistory = sqliteTable("gig_history", { ...historyMetadata, ...gigFields, ...recordMetadata }, (table) => [index("gig_history_entity_idx").on(table.id, table.revision), index("gig_history_change_idx").on(table.changeId), check("gig_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("gig_history_operation_check", sql`${table.operation} in ('update', 'delete')`)]);

const personFields={id:text("id").notNull(),name:text("name").notNull(),company:text("company"),title:text("title"),linkedInProfileUrl:text("linkedin_profile_url"),connectedOn:text("connected_on"),relationshipType:text("relationship_type").notNull().default("professional_contact"),relationshipStrength:text("relationship_strength").notNull().default("unknown"),introducedBy:text("introduced_by"),relationshipNotes:text("relationship_notes"),priority:text("priority").notNull().default("unranked"),status:text("status").notNull().default("not_contacted"),lastContacted:text("last_contacted"),lastContactMethod:text("last_contact_method"),lastContactSummary:text("last_contact_summary"),nextAction:text("next_action"),nextActionDue:text("next_action_due"),whyInteresting:text("why_interesting"),notesJson:text("notes_json").notNull().default("[]"),tagsJson:text("tags_json").notNull().default("[]")};
export const people=sqliteTable("people",{...personFields,id:text("id").primaryKey(),...recordMetadata},table=>[index("people_name_idx").on(table.name),index("people_priority_idx").on(table.priority),index("people_due_idx").on(table.nextActionDue),check("people_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const personHistory=sqliteTable("person_history",{...historyMetadata,...personFields,...recordMetadata},table=>[index("person_history_entity_idx").on(table.id,table.revision),check("person_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("person_history_operation_check",sql`${table.operation} in ('update','delete')`)]);

const gigPersonFields={id:text("id").notNull(),gigId:text("gig_id").notNull().references(()=>gigs.id),personId:text("person_id").notNull().references(()=>people.id),relationship:text("relationship").notNull(),notes:text("notes")};
export const gigPeople=sqliteTable("gig_people",{...gigPersonFields,id:text("id").primaryKey(),...recordMetadata},table=>[uniqueIndex("gig_people_relation_idx").on(table.gigId,table.personId,table.relationship),check("gig_people_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const gigPeopleHistory=sqliteTable("gig_people_history",{...historyMetadata,...gigPersonFields,...recordMetadata},table=>[index("gig_people_history_entity_idx").on(table.id,table.revision),check("gig_people_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("gig_people_history_operation_check",sql`${table.operation} in ('update','delete')`)]);

const taskFields = {
  id: text("id").notNull(), title: text("title").notNull(), type: text("type").notNull(), status: text("status").notNull(), priority: text("priority").notNull(), dueDate: text("due_date"), relatedEntityType: text("related_entity_type").notNull(), relatedEntityId: text("related_entity_id"), relatedEntityLabel: text("related_entity_label").notNull(), notes: text("notes"), completedAt: text("completed_at"),
};
export const tasks = sqliteTable("tasks", { ...taskFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("tasks_status_idx").on(table.status), index("tasks_due_idx").on(table.dueDate), index("tasks_deleted_idx").on(table.isDeleted), check("tasks_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const taskHistory = sqliteTable("task_history", { ...historyMetadata, ...taskFields, ...recordMetadata }, (table) => [index("task_history_entity_idx").on(table.id, table.revision), index("task_history_change_idx").on(table.changeId), check("task_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("task_history_operation_check", sql`${table.operation} in ('create', 'update', 'delete')`)]);

const meetingFields = {
  id: text("id").notNull(), title: text("title").notNull(), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(), timezone: text("timezone").notNull(), location: text("location"), description: text("description"), status: text("status").notNull(), gigId: text("gig_id").references(() => gigs.id), externalCalendarId: text("external_calendar_id"), externalEventId: text("external_event_id"),
};
export const meetings = sqliteTable("meetings", { ...meetingFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("meetings_start_idx").on(table.startsAt), index("meetings_deleted_idx").on(table.isDeleted), uniqueIndex("meetings_external_event_idx").on(table.externalCalendarId, table.externalEventId), check("meetings_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const meetingHistory = sqliteTable("meeting_history", {
  ...historyMetadata,
  ...meetingFields,
  legacyRelatedEntityType: text("legacy_related_entity_type"),
  legacyRelatedEntityId: text("legacy_related_entity_id"),
  ...recordMetadata,
}, (table) => [index("meeting_history_entity_idx").on(table.id, table.revision), index("meeting_history_change_idx").on(table.changeId), check("meeting_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("meeting_history_operation_check", sql`${table.operation} in ('update', 'delete')`)]);

const meetingParticipantFields = {
  id: text("id").notNull(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id),
  personId: text("person_id").notNull().references(() => people.id),
};
export const meetingParticipants = sqliteTable("meeting_participants", { ...meetingParticipantFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [uniqueIndex("meeting_participants_relation_idx").on(table.meetingId, table.personId), index("meeting_participants_meeting_idx").on(table.meetingId), index("meeting_participants_person_idx").on(table.personId), check("meeting_participants_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const meetingParticipantHistory = sqliteTable("meeting_participant_history", { ...historyMetadata, ...meetingParticipantFields, ...recordMetadata }, (table) => [index("meeting_participant_history_entity_idx").on(table.id, table.revision), index("meeting_participant_history_change_idx").on(table.changeId), check("meeting_participant_history_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("meeting_participant_history_operation_check", sql`${table.operation} in ('create', 'update', 'delete')`)]);

export const businessEvents = sqliteTable("business_events", {
  id: text("id").primaryKey(), changeId: text("change_id").references(() => changes.id), type: text("type").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), occurredAt: text("occurred_at").notNull(), summary: text("summary").notNull(), dataJson: text("data_json").notNull().default("{}"), supersedesEventId: text("supersedes_event_id"),
}, (table) => [index("business_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt), index("business_events_change_idx").on(table.changeId)]);

export const eventSources = sqliteTable("event_sources", {
  id: text("id").primaryKey(), eventId: text("event_id").notNull().references(() => businessEvents.id), sourceSystem: text("source_system").notNull(), externalId: text("external_id"), sourceTimestamp: text("source_timestamp"), sourceUri: text("source_uri"), importedAt: text("imported_at").notNull(), contentHash: text("content_hash"), excerpt: text("excerpt"),
}, (table) => [index("event_sources_event_idx").on(table.eventId), uniqueIndex("event_sources_external_idx").on(table.sourceSystem, table.externalId)]);

export const managedDocuments = sqliteTable("managed_documents", {
  id: text("id").primaryKey(),
  documentType: text("document_type", {
    enum: ["job_description", "notes", "interview_prep", "profile"],
  }).notNull(),
  title: text("title"),
  description: text("description"),
  mediaType: text("media_type", {
    enum: ["text/plain", "text/markdown"],
  }).notNull(),
  sourceDescription: text("source_description"),
  filePath: text("file_path"),
  uploadProvenanceJson: text("upload_provenance_json"),
  currentVersion: integer("current_version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("managed_documents_file_path_unique").on(table.filePath),
  check(
    "managed_documents_type_check",
    sql`${table.documentType} in ('job_description', 'notes', 'interview_prep', 'profile')`,
  ),
  check(
    "managed_documents_media_type_check",
    sql`${table.mediaType} in ('text/plain', 'text/markdown')`,
  ),
  check("managed_documents_current_version_check", sql`${table.currentVersion} > 0`),
  check(
    "managed_documents_description_check",
    sql`${table.description} is null or length(${table.description}) <= 255`,
  ),
  check(
    "managed_documents_file_path_check",
    sql`${table.filePath} is null or (instr(${table.filePath}, '/') = 0 and instr(${table.filePath}, '\\') = 0 and ${table.filePath} like '%.md')`,
  ),
]);

export const candidateProfiles = sqliteTable("candidate_profiles", {
  id: text("id").primaryKey(),
});

export const managedDocumentLinks = sqliteTable("managed_document_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: text("document_id").notNull()
    .references(() => managedDocuments.id),
  gigId: text("gig_id").references(() => gigs.id),
  personId: text("person_id").references(() => people.id),
  profileId: text("profile_id").references(() => candidateProfiles.id),
}, (table) => [
  index("managed_document_links_document_idx").on(table.documentId),
  index("managed_document_links_gig_idx").on(table.gigId),
  index("managed_document_links_person_idx").on(table.personId),
  index("managed_document_links_profile_idx").on(table.profileId),
  uniqueIndex("managed_document_links_gig_unique").on(table.documentId, table.gigId),
  uniqueIndex("managed_document_links_person_unique").on(table.documentId, table.personId),
  uniqueIndex("managed_document_links_profile_unique").on(table.documentId, table.profileId),
  check(
    "managed_document_links_target_check",
    sql`(${table.gigId} is not null and ${table.personId} is null and ${table.profileId} is null) or (${table.gigId} is null and ${table.personId} is not null and ${table.profileId} is null) or (${table.gigId} is null and ${table.personId} is null and ${table.profileId} is not null)`,
  ),
]);

export const managedDocumentVersions = sqliteTable("managed_document_versions", {
  documentId: text("document_id").notNull()
    .references(() => managedDocuments.id),
  version: integer("version").notNull(),
  parentVersion: integer("parent_version"),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  changeId: text("change_id").notNull().references(() => changes.id),
  changeSummary: text("change_summary").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  primaryKey({ columns: [table.documentId, table.version] }),
  index("managed_document_versions_change_idx").on(table.changeId),
  check("managed_document_versions_version_check", sql`${table.version} > 0`),
  check(
    "managed_document_versions_parent_check",
    sql`${table.parentVersion} is null or ${table.parentVersion} < ${table.version}`,
  ),
]);

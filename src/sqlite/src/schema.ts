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
  operation: text("operation", { enum: ["update", "delete"] }).notNull(),
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

const jobFields = {
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

export const jobs = sqliteTable("jobs", { ...jobFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("jobs_stage_idx").on(table.stage), index("jobs_due_idx").on(table.nextActionDue), index("jobs_deleted_idx").on(table.isDeleted), check("jobs_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const jobHistory = sqliteTable("job_history", { ...historyMetadata, ...jobFields, ...recordMetadata }, (table) => [index("job_history_entity_idx").on(table.id, table.revision), index("job_history_change_idx").on(table.changeId), check("job_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("job_history_operation_check", sql`${table.operation} in ('update', 'delete')`)]);

const personFields={id:text("id").notNull(),name:text("name").notNull(),company:text("company"),title:text("title"),linkedInProfileUrl:text("linkedin_profile_url"),connectedOn:text("connected_on"),hasLocalProfile:integer("has_local_profile",{mode:"boolean"}).notNull().default(false)};
export const people=sqliteTable("people",{...personFields,id:text("id").primaryKey(),...recordMetadata},table=>[index("people_name_idx").on(table.name),check("people_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const personHistory=sqliteTable("person_history",{...historyMetadata,...personFields,...recordMetadata},table=>[index("person_history_entity_idx").on(table.id,table.revision),check("person_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("person_history_operation_check",sql`${table.operation} in ('update','delete')`)]);

const networkingFields={id:text("id").notNull(),personId:text("person_id").notNull().references(()=>people.id),relationshipType:text("relationship_type").notNull(),relationshipStrength:text("relationship_strength").notNull(),introducedBy:text("introduced_by"),relationshipNotes:text("relationship_notes"),priority:text("priority").notNull(),status:text("status").notNull(),lastContacted:text("last_contacted"),lastContactMethod:text("last_contact_method"),lastContactSummary:text("last_contact_summary"),nextAction:text("next_action"),nextActionDue:text("next_action_due"),whyInteresting:text("why_interesting"),notesJson:text("notes_json").notNull().default("[]"),tagsJson:text("tags_json").notNull().default("[]")};
export const networkingContacts=sqliteTable("networking_contacts",{...networkingFields,id:text("id").primaryKey(),...recordMetadata},table=>[uniqueIndex("networking_person_idx").on(table.personId),index("networking_priority_idx").on(table.priority),index("networking_due_idx").on(table.nextActionDue),check("networking_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const networkingContactHistory=sqliteTable("networking_contact_history",{...historyMetadata,...networkingFields,...recordMetadata},table=>[index("networking_history_entity_idx").on(table.id,table.revision),check("networking_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("networking_history_operation_check",sql`${table.operation} in ('update','delete')`)]);

const jobPersonFields={id:text("id").notNull(),jobId:text("job_id").notNull().references(()=>jobs.id),personId:text("person_id").notNull().references(()=>people.id),relationship:text("relationship").notNull(),notes:text("notes")};
export const jobPeople=sqliteTable("job_people",{...jobPersonFields,id:text("id").primaryKey(),...recordMetadata},table=>[uniqueIndex("job_people_relation_idx").on(table.jobId,table.personId,table.relationship),check("job_people_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const jobPeopleHistory=sqliteTable("job_people_history",{...historyMetadata,...jobPersonFields,...recordMetadata},table=>[index("job_people_history_entity_idx").on(table.id,table.revision),check("job_people_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("job_people_history_operation_check",sql`${table.operation} in ('update','delete')`)]);

const taskFields = {
  id: text("id").notNull(), title: text("title").notNull(), type: text("type").notNull(), status: text("status").notNull(), priority: text("priority").notNull(), dueDate: text("due_date"), relatedEntityType: text("related_entity_type").notNull(), relatedEntityId: text("related_entity_id"), relatedEntityLabel: text("related_entity_label").notNull(), notes: text("notes"), completedAt: text("completed_at"),
};
export const tasks = sqliteTable("tasks", { ...taskFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("tasks_status_idx").on(table.status), index("tasks_due_idx").on(table.dueDate), index("tasks_deleted_idx").on(table.isDeleted), check("tasks_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const taskHistory = sqliteTable("task_history", { ...historyMetadata, ...taskFields, ...recordMetadata }, (table) => [index("task_history_entity_idx").on(table.id, table.revision), index("task_history_change_idx").on(table.changeId), check("task_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("task_history_operation_check", sql`${table.operation} in ('update', 'delete')`)]);

const meetingFields = {
  id: text("id").notNull(), title: text("title").notNull(), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(), timezone: text("timezone").notNull(), location: text("location"), description: text("description"), status: text("status").notNull(), relatedEntityType: text("related_entity_type"), relatedEntityId: text("related_entity_id"), externalCalendarId: text("external_calendar_id"), externalEventId: text("external_event_id"),
};
export const meetings = sqliteTable("meetings", { ...meetingFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("meetings_start_idx").on(table.startsAt), index("meetings_deleted_idx").on(table.isDeleted), uniqueIndex("meetings_external_event_idx").on(table.externalCalendarId, table.externalEventId), check("meetings_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const meetingHistory = sqliteTable("meeting_history", { ...historyMetadata, ...meetingFields, ...recordMetadata }, (table) => [index("meeting_history_entity_idx").on(table.id, table.revision), index("meeting_history_change_idx").on(table.changeId), check("meeting_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("meeting_history_operation_check", sql`${table.operation} in ('update', 'delete')`)]);

export const businessEvents = sqliteTable("business_events", {
  id: text("id").primaryKey(), changeId: text("change_id").references(() => changes.id), type: text("type").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), occurredAt: text("occurred_at").notNull(), summary: text("summary").notNull(), dataJson: text("data_json").notNull().default("{}"), supersedesEventId: text("supersedes_event_id"),
}, (table) => [index("business_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt), index("business_events_change_idx").on(table.changeId)]);

export const eventSources = sqliteTable("event_sources", {
  id: text("id").primaryKey(), eventId: text("event_id").notNull().references(() => businessEvents.id), sourceSystem: text("source_system").notNull(), externalId: text("external_id"), sourceTimestamp: text("source_timestamp"), sourceUri: text("source_uri"), importedAt: text("imported_at").notNull(), contentHash: text("content_hash"), excerpt: text("excerpt"),
}, (table) => [index("event_sources_event_idx").on(table.eventId), uniqueIndex("event_sources_external_idx").on(table.sourceSystem, table.externalId)]);

export const managedDocuments = sqliteTable("managed_documents", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: ["job"] }).notNull(),
  ownerId: text("owner_id").notNull().references(() => jobs.id),
  documentType: text("document_type", {
    enum: ["job_description", "notes", "interview_prep"],
  }).notNull(),
  title: text("title").notNull(),
  mediaType: text("media_type", {
    enum: ["text/plain", "text/markdown"],
  }).notNull(),
  sourceDescription: text("source_description"),
  currentVersion: integer("current_version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("managed_documents_owner_idx").on(table.ownerType, table.ownerId),
  check("managed_documents_owner_type_check", sql`${table.ownerType} = 'job'`),
  check(
    "managed_documents_type_check",
    sql`${table.documentType} in ('job_description', 'notes', 'interview_prep')`,
  ),
  check(
    "managed_documents_media_type_check",
    sql`${table.mediaType} in ('text/plain', 'text/markdown')`,
  ),
  check("managed_documents_current_version_check", sql`${table.currentVersion} > 0`),
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

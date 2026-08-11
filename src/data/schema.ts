import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
export const creationIdempotency=sqliteTable("creation_idempotency",{changeId:text("change_id").primaryKey().references(()=>changes.id),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),payloadHash:text("payload_hash").notNull()});

export const applicationSettings = sqliteTable("application_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const conversationFields = {
  id: text("id").notNull(),
  title: text("title").notNull(),
  lastActiveAt: text("last_active_at").notNull(),
};

export const conversations = sqliteTable("conversations", {
  ...conversationFields,
  id: text("id").primaryKey(),
  ...recordMetadata,
}, table => [
  index("conversations_last_active_idx").on(table.lastActiveAt),
  check("conversations_deleted_check", sql`${table.isDeleted} in (0, 1)`),
]);

export const conversationHistory = sqliteTable("conversation_history", {
  ...historyMetadata,
  ...conversationFields,
  ...recordMetadata,
}, table => [
  index("conversation_history_entity_idx").on(table.id, table.revision),
  index("conversation_history_change_idx").on(table.changeId),
  check("conversation_history_deleted_check", sql`${table.isDeleted} in (0, 1)`),
  check("conversation_history_operation_check", sql`${table.operation} = 'update'`),
]);

export const conversationMessages = sqliteTable("conversation_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull()
    .references(() => conversations.id),
  sequence: integer("sequence").notNull(),
  messageJson: text("message_json").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  uniqueIndex("conversation_messages_sequence_idx")
    .on(table.conversationId, table.sequence),
  index("conversation_messages_conversation_idx").on(table.conversationId),
]);

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

const personFields={id:text("id").notNull(),name:text("name").notNull(),company:text("company"),title:text("title"),linkedInProfileUrl:text("linkedin_profile_url"),connectedOn:text("connected_on"),relationshipType:text("relationship_type").notNull().default("professional_contact"),relationshipStrength:text("relationship_strength").notNull().default("unknown"),introducedBy:text("introduced_by"),relationshipNotes:text("relationship_notes"),priority:text("priority").notNull().default("unranked"),status:text("status").notNull().default("not_contacted"),whyInteresting:text("why_interesting"),notesJson:text("notes_json").notNull().default("[]"),tagsJson:text("tags_json").notNull().default("[]")};
export const people=sqliteTable("people",{...personFields,id:text("id").primaryKey(),...recordMetadata},table=>[index("people_name_idx").on(table.name),index("people_priority_idx").on(table.priority),check("people_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const personHistory=sqliteTable("person_history",{...historyMetadata,...personFields,...recordMetadata},table=>[index("person_history_entity_idx").on(table.id,table.revision),check("person_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("person_history_operation_check",sql`${table.operation} in ('update','delete')`)]);
export const legacyPersonFollowUpArchive=sqliteTable("legacy_person_follow_up_archive",{archiveId:text("archive_id").primaryKey(),sourceKind:text("source_kind",{enum:["current","history"]}).notNull(),personId:text("person_id").notNull(),sourceHistoryId:integer("source_history_id"),sourceChangeId:text("source_change_id"),sourceOperation:text("source_operation"),sourceRevision:integer("source_revision").notNull(),nextAction:text("next_action"),nextActionDue:text("next_action_due"),capturedAt:text("captured_at").notNull()},table=>[index("legacy_person_follow_up_archive_person_idx").on(table.personId,table.sourceRevision),check("legacy_person_follow_up_archive_source_check",sql`${table.sourceKind} in ('current','history')`)]);

const gigPersonFields={id:text("id").notNull(),gigId:text("gig_id").notNull().references(()=>gigs.id),personId:text("person_id").notNull().references(()=>people.id),relationship:text("relationship").notNull(),notes:text("notes")};
export const gigPeople=sqliteTable("gig_people",{...gigPersonFields,id:text("id").primaryKey(),...recordMetadata},table=>[uniqueIndex("gig_people_relation_idx").on(table.gigId,table.personId,table.relationship).where(sql`${table.isDeleted} = 0`),check("gig_people_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const gigPeopleHistory=sqliteTable("gig_people_history",{...historyMetadata,...gigPersonFields,...recordMetadata},table=>[index("gig_people_history_entity_idx").on(table.id,table.revision),check("gig_people_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("gig_people_history_operation_check",sql`${table.operation} in ('create','update','delete')`)]);

const taskFields = {
  id: text("id").notNull(), title: text("title").notNull(), type: text("type").notNull(), status: text("status").notNull(), priority: text("priority").notNull(), dueDate: text("due_date"), relatedEntityType: text("related_entity_type").notNull(), relatedEntityId: text("related_entity_id"), relatedEntityLabel: text("related_entity_label").notNull(), notes: text("notes"), completedAt: text("completed_at"),
};
export const tasks = sqliteTable("tasks", { ...taskFields, id: text("id").primaryKey(), ...recordMetadata }, (table) => [index("tasks_status_idx").on(table.status), index("tasks_due_idx").on(table.dueDate), index("tasks_deleted_idx").on(table.isDeleted), check("tasks_is_deleted_check", sql`${table.isDeleted} in (0, 1)`)]);
export const taskHistory = sqliteTable("task_history", { ...historyMetadata, ...taskFields, ...recordMetadata }, (table) => [index("task_history_entity_idx").on(table.id, table.revision), index("task_history_change_idx").on(table.changeId), check("task_history_is_deleted_check", sql`${table.isDeleted} in (0, 1)`), check("task_history_operation_check", sql`${table.operation} in ('create', 'update', 'delete')`)]);

const interactionFields={id:text("id").notNull(),subject:text("subject").notNull(),kind:text("kind").notNull(),channel:text("channel").notNull(),direction:text("direction").notNull(),status:text("status").notNull(),startsAt:text("starts_at").notNull(),endsAt:text("ends_at"),timezone:text("timezone"),location:text("location"),summary:text("summary"),notes:text("notes"),gigId:text("gig_id").references(()=>gigs.id),supersedesInteractionId:text("supersedes_interaction_id").references(():AnySQLiteColumn=>interactions.id),originChangeId:text("origin_change_id").references(()=>changes.id),structuredDataJson:text("structured_data_json").notNull().default("{}")};
// Drizzle callback tables do not expose a reusable public inferred type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const interactionChecks=(table:any)=>[check("interactions_time_check",sql`${table.endsAt} is null or (julianday(${table.endsAt}) is not null and julianday(${table.startsAt}) is not null and julianday(${table.endsAt}) >= julianday(${table.startsAt}))`),check("interactions_kind_check",sql`${table.kind} in ('message','call','meeting','interview','conversation','other')`),check("interactions_channel_check",sql`${table.channel} in ('email','linkedin','sms','chat','phone','video','in_person','other')`),check("interactions_direction_check",sql`${table.direction} in ('inbound','outbound','mutual','unknown')`),check("interactions_status_check",sql`${table.status} in ('planned','confirmed','completed','canceled','no_show')`),check("interactions_structured_data_check",sql`json_valid(${table.structuredDataJson}) and json_type(${table.structuredDataJson}) = 'object'`),check("interactions_supersedes_check",sql`${table.supersedesInteractionId} is null or ${table.supersedesInteractionId} <> ${table.id}`)];
export const interactions=sqliteTable("interactions",{...interactionFields,id:text("id").primaryKey(),...recordMetadata},table=>[index("interactions_start_idx").on(table.startsAt),index("interactions_gig_idx").on(table.gigId),index("interactions_deleted_idx").on(table.isDeleted),check("interactions_deleted_check",sql`${table.isDeleted} in (0,1)`),...interactionChecks(table)]);
export const interactionHistory=sqliteTable("interaction_history",{...historyMetadata,...interactionFields,...recordMetadata},table=>[index("interaction_history_entity_idx").on(table.id,table.revision),index("interaction_history_change_idx").on(table.changeId),check("interaction_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("interaction_history_operation_check",sql`${table.operation} in ('create','update','delete')`)]);
const interactionParticipantFields={id:text("id").notNull(),interactionId:text("interaction_id").notNull().references(()=>interactions.id),personId:text("person_id").notNull().references(()=>people.id)};
export const interactionParticipants=sqliteTable("interaction_participants",{...interactionParticipantFields,id:text("id").primaryKey(),...recordMetadata},table=>[uniqueIndex("interaction_participants_relation_idx").on(table.interactionId,table.personId),index("interaction_participants_interaction_idx").on(table.interactionId),index("interaction_participants_person_idx").on(table.personId),check("interaction_participants_deleted_check",sql`${table.isDeleted} in (0,1)`)]);
export const interactionParticipantHistory=sqliteTable("interaction_participant_history",{...historyMetadata,...interactionParticipantFields,...recordMetadata},table=>[index("interaction_participant_history_entity_idx").on(table.id,table.revision),index("interaction_participant_history_change_idx").on(table.changeId),check("interaction_participant_history_deleted_check",sql`${table.isDeleted} in (0,1)`),check("interaction_participant_history_operation_check",sql`${table.operation} in ('create','update','delete')`)]);
export const interactionSources=sqliteTable("interaction_sources",{id:text("id").primaryKey(),interactionId:text("interaction_id").notNull().references(()=>interactions.id),sourceSystem:text("source_system").notNull(),externalId:text("external_id"),sourceTimestamp:text("source_timestamp"),sourceUri:text("source_uri"),importedAt:text("imported_at").notNull(),contentHash:text("content_hash"),excerpt:text("excerpt"),originChangeId:text("origin_change_id").references(()=>changes.id)},table=>[index("interaction_sources_interaction_idx").on(table.interactionId),uniqueIndex("interaction_sources_identity_idx").on(table.sourceSystem,table.externalId)]);
export const interactionLegacyRefs=sqliteTable("interaction_legacy_refs",{id:text("id").primaryKey(),interactionId:text("interaction_id").notNull().references(()=>interactions.id),legacyType:text("legacy_type").notNull(),legacyId:text("legacy_id").notNull(),legacyRevision:integer("legacy_revision"),originChangeId:text("origin_change_id").references(()=>changes.id)},table=>[uniqueIndex("interaction_legacy_refs_identity_idx").on(table.legacyType,table.legacyId,table.legacyRevision)]);

export const businessEvents = sqliteTable("business_events", {
  id: text("id").primaryKey(),
  changeId: text("change_id").references(() => changes.id),
  type: text("type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
  summary: text("summary").notNull(),
  dataJson: text("data_json").notNull().default("{}"),
  supersedesEventId: text("supersedes_event_id"),
}, table => [
  index("business_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
  index("business_events_change_idx").on(table.changeId),
]);

export const eventSources = sqliteTable("event_sources", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => businessEvents.id),
  sourceSystem: text("source_system").notNull(),
  externalId: text("external_id"),
  sourceTimestamp: text("source_timestamp"),
  sourceUri: text("source_uri"),
  importedAt: text("imported_at").notNull(),
  contentHash: text("content_hash"),
  excerpt: text("excerpt"),
}, table => [
  index("event_sources_event_idx").on(table.eventId),
  uniqueIndex("event_sources_external_idx").on(table.sourceSystem, table.externalId),
]);

export const scoutCompanies=sqliteTable("scout_companies",{id:text("id").primaryKey(),name:text("name").notNull(),active:integer("active",{mode:"boolean"}).notNull().default(true),currentConfigurationId:text("current_configuration_id"),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()});
export const scoutCompanyConfigurations=sqliteTable("scout_company_configurations",{id:text("id").primaryKey(),companyId:text("company_id").notNull().references(()=>scoutCompanies.id),version:integer("version").notNull(),fingerprint:text("fingerprint").notNull(),createdAt:text("created_at").notNull()},table=>[uniqueIndex("scout_company_configuration_version_idx").on(table.companyId,table.version),uniqueIndex("scout_company_configuration_fingerprint_idx").on(table.companyId,table.fingerprint)]);
export const scoutCompanyConfigurationSources=sqliteTable("scout_company_configuration_sources",{id:text("id").primaryKey(),companyConfigurationId:text("company_configuration_id").notNull().references(()=>scoutCompanyConfigurations.id),sourceKey:text("source_key").notNull(),sourceType:text("source_type").notNull(),settingsJson:text("settings_json").notNull(),active:integer("active",{mode:"boolean"}).notNull().default(true)});
export const scoutRuns=sqliteTable("scout_runs",{id:text("id").primaryKey(),status:text("status").notNull(),runType:text("run_type").notNull().default("full"),batchSize:integer("batch_size").notNull(),concurrency:integer("concurrency").notNull(),createdAt:text("created_at").notNull(),startedAt:text("started_at"),completedAt:text("completed_at"),companyCount:integer("company_count").notNull().default(0),succeededCount:integer("succeeded_count").notNull().default(0),failedCount:integer("failed_count").notNull().default(0)});
export const scoutRunCompanies=sqliteTable("scout_run_companies",{id:text("id").primaryKey(),runId:text("run_id").notNull().references(()=>scoutRuns.id),companyId:text("company_id").notNull().references(()=>scoutCompanies.id),companyConfigurationId:text("company_configuration_id").notNull().references(()=>scoutCompanyConfigurations.id),status:text("status").notNull(),startedAt:text("started_at"),completedAt:text("completed_at"),failureCode:text("failure_code"),failureMessage:text("failure_message")});
export const scoutRunSources=sqliteTable("scout_run_sources",{id:text("id").primaryKey(),runCompanyId:text("run_company_id").notNull().references(()=>scoutRunCompanies.id),configurationSourceId:text("configuration_source_id").notNull().references(()=>scoutCompanyConfigurationSources.id),status:text("status").notNull(),candidateCount:integer("candidate_count").notNull(),acceptedCount:integer("accepted_count").notNull(),rejectedCount:integer("rejected_count").notNull()});
export const scoutSourceAttempts=sqliteTable("scout_source_attempts",{id:text("id").primaryKey(),runSourceId:text("run_source_id").notNull().references(()=>scoutRunSources.id),attemptNumber:integer("attempt_number").notNull(),adapter:text("adapter").notNull(),stage:text("stage").notNull(),requestCount:integer("request_count").notNull(),responseCount:integer("response_count").notNull(),candidateCount:integer("candidate_count").notNull(),acceptedCount:integer("accepted_count").notNull(),rejectedCount:integer("rejected_count").notNull(),validationStatus:text("validation_status").notNull(),startedAt:text("started_at").notNull(),completedAt:text("completed_at").notNull(),failureCode:text("failure_code"),failureMessage:text("failure_message")});
export const scoutAttemptDiagnostics=sqliteTable("scout_attempt_diagnostics",{id:text("id").primaryKey(),sourceAttemptId:text("source_attempt_id").notNull().references(()=>scoutSourceAttempts.id),code:text("code").notNull(),category:text("category").notNull(),count:integer("count").notNull(),message:text("message").notNull()});
export const scoutRunOutbox=sqliteTable("scout_run_outbox",{id:text("id").primaryKey(),runCompanyId:text("run_company_id").notNull().references(()=>scoutRunCompanies.id),queueJobId:text("queue_job_id").notNull(),dispatchStatus:text("dispatch_status").notNull(),createdAt:text("created_at").notNull(),dispatchedAt:text("dispatched_at")});
export const scoutPositions=sqliteTable("scout_positions",{id:text("id").primaryKey(),companyId:text("company_id").notNull().references(()=>scoutCompanies.id),sourceKey:text("source_key").notNull(),identityKind:text("identity_kind").notNull(),identityValue:text("identity_value").notNull(),externalId:text("external_id"),canonicalUrl:text("canonical_url").notNull(),title:text("title").notNull(),location:text("location"),firstSeenAt:text("first_seen_at").notNull(),lastSeenAt:text("last_seen_at").notNull()});
export const scoutDescriptionArtifacts=sqliteTable("scout_description_artifacts",{id:text("id").primaryKey(),filePath:text("file_path").notNull(),contentHash:text("content_hash").notNull(),mediaType:text("media_type").notNull(),byteCount:integer("byte_count").notNull(),provenanceJson:text("provenance_json").notNull(),createdAt:text("created_at").notNull()});
export const scoutPositionObservations=sqliteTable("scout_position_observations",{id:text("id").primaryKey(),runSourceId:text("run_source_id").notNull().references(()=>scoutRunSources.id),positionId:text("position_id").notNull().references(()=>scoutPositions.id),descriptionArtifactId:text("description_artifact_id").references(()=>scoutDescriptionArtifacts.id),title:text("title").notNull(),canonicalUrl:text("canonical_url").notNull(),location:text("location"),provenanceJson:text("provenance_json").notNull(),observedAt:text("observed_at").notNull()});

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
  materializedVersion: integer("materialized_version"),
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
  check(
    "managed_documents_materialized_version_check",
    sql`${table.materializedVersion} is null or (${table.materializedVersion} > 0 and ${table.materializedVersion} <= ${table.currentVersion})`,
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

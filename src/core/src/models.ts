export type EntityName = "job" | "person" | "networking" | "task" | "meeting";
export type ChangeSource = "user_request" | "agent" | "automation" | "import" | "recovery" | "test";

export interface ChangeContext {
  actor: string;
  source: ChangeSource;
  summary: string;
  occurredAt?: string;
  parentChangeId?: string | null;
  changeId?: string;
}

export interface RecordMetadata {
  revision: number;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EntityRecord<T> = T & RecordMetadata;

export interface JobData {
  id: string; company: string; title: string; externalJobId: string | null; stage: string; outcome: string; statusSummary: string; lastActivity: string; nextActionDescription: string | null; nextActionDue: string | null; fitRating: string; fitSummary: string | null; payCurrency: string | null; payMinimum: number | null; payMaximum: number | null; payPeriod: string | null; payNotes: string | null; sourceUrl: string | null; location: string | null; workArrangement: string | null; postedDate: string | null; businessUnitTeam: string | null; recruiterSource: string | null; bonus: string | null; equity: string | null; otherCompensation: string | null; tagsJson: string; hasJobDescription:boolean; hasInterviewPrep:boolean;
}
export interface PersonData {
  id:string; name:string; company:string|null; title:string|null; linkedInProfileUrl:string|null; connectedOn:string|null;
}
export interface NetworkingContactData {
  id:string; personId:string; relationshipType:string; relationshipStrength:string; introducedBy:string|null; relationshipNotes:string|null; priority:string; status:string; lastContacted:string|null; lastContactMethod:string|null; lastContactSummary:string|null; nextAction:string|null; nextActionDue:string|null; whyInteresting:string|null; notesJson:string; tagsJson:string;
}
export interface JobPersonData {
  id:string; jobId:string; personId:string; relationship:string; notes:string|null;
}
export interface TaskData {
  id: string; title: string; type: string; status: string; priority: string; dueDate: string | null; relatedEntityType: string; relatedEntityId: string | null; relatedEntityLabel: string; notes: string | null; completedAt: string | null;
}
export interface MeetingData {
  id: string; title: string; startsAt: string; endsAt: string; timezone: string; location: string | null; description: string | null; status: string; relatedEntityType: string | null; relatedEntityId: string | null; externalCalendarId: string | null; externalEventId: string | null;
}

export interface BusinessEventInput {
  id?: string;
  type: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  summary: string;
  data?: Record<string, unknown>;
  supersedesEventId?: string | null;
  sources?: EventSourceInput[];
}

export interface EventSourceInput {
  id?: string;
  sourceSystem: string;
  externalId?: string | null;
  sourceTimestamp?: string | null;
  sourceUri?: string | null;
  importedAt: string;
  contentHash?: string | null;
  excerpt?: string | null;
}

export interface ChangeResult<T> { changeId: string; value: T }

export interface RevertedRecord {
  entity: string;
  id: string;
}

export type NetworkingContactView = EntityRecord<NetworkingContactData> & { person:EntityRecord<PersonData> };

export type EntityName = "gig" | "person" | "gig-person" | "task" | "interaction" | "interaction-participant";
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

export interface GigData {
  id: string; company: string; title: string; externalJobId: string | null; stage: string; outcome: string; statusSummary: string; lastActivity: string; nextActionDescription: string | null; nextActionDue: string | null; fitRating: string; fitSummary: string | null; payCurrency: string | null; payMinimum: number | null; payMaximum: number | null; payPeriod: string | null; payNotes: string | null; sourceUrl: string | null; location: string | null; workArrangement: string | null; postedDate: string | null; businessUnitTeam: string | null; recruiterSource: string | null; bonus: string | null; equity: string | null; otherCompensation: string | null; tagsJson: string; hasJobDescription:boolean; hasInterviewPrep:boolean;
}
export interface PersonData {
  id:string; name:string; company:string|null; title:string|null; linkedInProfileUrl:string|null; connectedOn:string|null;
  relationshipType:string; relationshipStrength:string; introducedBy:string|null; relationshipNotes:string|null;
  priority:string; status:string;
  whyInteresting:string|null; notesJson:string; tagsJson:string;
}
export interface GigPersonData {
  id:string; gigId:string; personId:string; relationship:string; notes:string|null;
}
export interface TaskData {
  id: string; title: string; type: string; status: string; priority: string; dueDate: string | null; relatedEntityType: string; relatedEntityId: string | null; relatedEntityLabel: string; notes: string | null; completedAt: string | null;
}
export interface InteractionData { id:string; subject:string; kind:string; channel:string; direction:string; status:string; startsAt:string; endsAt:string|null; timezone:string|null; location:string|null; summary:string|null; notes:string|null; gigId:string|null; supersedesInteractionId:string|null; originChangeId:string|null; structuredDataJson:string }
export interface InteractionParticipantData { id:string; interactionId:string; personId:string }


export interface ChangeResult<T> { changeId: string; value: T }

export interface RevertedRecord {
  entity: string;
  id: string;
}

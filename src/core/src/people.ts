export const jobPersonRelationships = [
  "interviewer",
  "hiring_manager",
  "recruiter",
  "recruiting_coordinator",
  "employee",
  "former_peer",
  "professional_contact",
  "personal_contact",
] as const;

export type JobPersonRelationshipType = typeof jobPersonRelationships[number];

export interface JobPersonRelationship {
  id: string;
  jobId: string;
  personId: string;
  relationship: JobPersonRelationshipType;
  notes: string | null;
}

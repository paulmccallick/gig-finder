export const gigPersonRelationships = [
  "interviewer",
  "hiring_manager",
  "recruiter",
  "recruiting_coordinator",
  "employee",
  "former_peer",
  "professional_contact",
  "personal_contact",
] as const;

export type GigPersonRelationshipType = typeof gigPersonRelationships[number];

export interface GigPersonRelationship {
  id: string;
  gigId: string;
  personId: string;
  relationship: GigPersonRelationshipType;
  notes: string | null;
}

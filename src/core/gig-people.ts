import { z } from "zod";

export const gigPersonRelationships=["interviewer","hiring_manager","recruiter","recruiting_coordinator","employee","former_peer","professional_contact","personal_contact"] as const;
export type GigPersonRelationshipType=typeof gigPersonRelationships[number];
export const gigPersonRelationshipEntitySchema=z.object({id:z.string().trim().min(1),gigId:z.string().trim().min(1).describe("Exact Gig ID."),personId:z.string().trim().min(1).describe("Exact Person ID."),relationship:z.enum(gigPersonRelationships).describe("Relationship role."),notes:z.string().trim().nullable().describe("Notes, or null.")}).strict();
export const gigPersonRelationshipInputSchema=gigPersonRelationshipEntitySchema.omit({id:true}).partial().strict().refine(value=>Object.keys(value).length>0,"Relationship input must contain at least one field.");
export type GigPersonRelationship=z.infer<typeof gigPersonRelationshipEntitySchema>;
export type GigPersonRelationshipInput=z.infer<typeof gigPersonRelationshipInputSchema>;

import { z } from "zod";

export const candidateProfileId = "candidate";

export const documentLinkEntityTypes = ["gig", "person", "profile"] as const;
export type DocumentLinkEntityType = typeof documentLinkEntityTypes[number];

export const managedDocumentTypes = [
  "job_description",
  "notes",
  "interview_prep",
  "profile",
] as const;
export type ManagedDocumentType = typeof managedDocumentTypes[number];

export const documentMediaTypes = ["text/plain", "text/markdown"] as const;
export type DocumentMediaType = typeof documentMediaTypes[number];

export const managedDocumentContentLimit = 50_000;
export const profileDocumentDescriptionLimit = 255;

export const uploadedSourceMediaTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
] as const;
export type UploadedSourceMediaType = typeof uploadedSourceMediaTypes[number];

export interface UploadedDocumentProvenance {
  originalFilename: string;
  detectedMediaType: UploadedSourceMediaType;
  sourceContentHash: string;
  converter: string;
  converterVersion: string;
  extractionWarnings: string[];
  uploadedAt: string;
}

export interface ManagedDocumentSourceProvenance {
  officialUrl: string;
  retrievedAt: string;
  sourceContentHash: string;
  extractedContentHash: string;
  sourceKey: string;
  configurationVersion: number;
  extractionStrategy: string;
  converterVersion: string;
}

export interface DocumentLink {
  entityType: DocumentLinkEntityType;
  entityId: string;
}

export interface DocumentSummary {
  id: string;
  type: ManagedDocumentType;
  title: string | null;
  displayName: string;
  currentVersion: number;
}

export interface ManagedDocumentVersionData {
  documentId: string;
  version: number;
  parentVersion: number | null;
  content: string;
  contentHash: string;
  changeId: string;
  changeSummary: string;
  createdAt: string;
  createdBy: string;
  sourceDescription: string | null;
  sourceProvenance: ManagedDocumentSourceProvenance | null;
}

export interface UpdateManagedDocumentInput {
  documentId: string;
  expectedVersion: number;
  content: string;
  changeSummary: string;
  sourceDescription?: string;
  sourceProvenance?: ManagedDocumentSourceProvenance;
}

export interface ManagedDocumentMutationResult {
  document: ManagedDocumentRecord;
  changeId: string | null;
  changed: boolean;
}

export interface ProfileDocumentContext {
  id: string;
  name: string;
  type: ManagedDocumentType;
  description: string | null;
  currentVersion: number;
}

const contentSchema = z.string()
  .min(1, "Document content cannot be empty.")
  .max(
    managedDocumentContentLimit,
    `Document content cannot exceed ${managedDocumentContentLimit} characters.`,
  );

export const uploadedDocumentProvenanceSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  detectedMediaType: z.enum(uploadedSourceMediaTypes),
  sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  converter: z.string().trim().min(1).max(100),
  converterVersion: z.string().trim().min(1).max(100),
  extractionWarnings: z.array(z.string().trim().min(1).max(500)).max(20),
  uploadedAt: z.string().datetime(),
}).strict();

export const managedDocumentSourceProvenanceSchema = z.object({
  officialUrl: z.string().url().max(2_000),
  retrievedAt: z.string().datetime({ offset: true }),
  sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  extractedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceKey: z.string().trim().min(1).max(100),
  configurationVersion: z.number().int().positive(),
  extractionStrategy: z.string().trim().min(1).max(100),
  converterVersion: z.string().trim().min(1).max(100),
}).strict();

export const documentLinkSchema = z.object({
  entityType: z.enum(documentLinkEntityTypes),
  entityId: z.string().trim().min(1).max(200),
}).strict();

const managedDocumentMutableFields={links:z.array(documentLinkSchema).min(1).describe("Document owners."),documentType:z.enum(managedDocumentTypes).describe("Document type."),title:z.string().trim().min(1).max(200).nullable().describe("Title, or null."),description:z.string().trim().min(1).max(profileDocumentDescriptionLimit).nullable().describe("Description, or null."),mediaType:z.enum(documentMediaTypes).describe("Media type."),sourceDescription:z.string().trim().min(1).max(500).nullable().describe("Source description, or null."),uploadProvenance:uploadedDocumentProvenanceSchema.nullable().describe("Upload provenance, or null.")};
export const managedDocumentEntitySchema=z.object({id:z.string().trim().min(1),...managedDocumentMutableFields,filePath:z.string().nullable(),displayName:z.string().min(1),currentVersion:z.number().int().positive(),content:contentSchema,contentHash:z.string().regex(/^[0-9a-f]{64}$/),createdAt:z.string().datetime({offset:true}),updatedAt:z.string().datetime({offset:true})}).strict();
export const managedDocumentInputSchema=z.object({links:managedDocumentMutableFields.links.optional(),documentType:managedDocumentMutableFields.documentType.optional(),title:managedDocumentMutableFields.title.optional(),description:managedDocumentMutableFields.description.optional(),mediaType:managedDocumentMutableFields.mediaType.optional(),sourceDescription:managedDocumentMutableFields.sourceDescription.optional(),uploadProvenance:managedDocumentMutableFields.uploadProvenance.optional()}).strict().refine(value=>Object.keys(value).length>0,"Managed-document input must contain at least one field.");
export type ManagedDocumentInput=z.infer<typeof managedDocumentInputSchema>;
export const createManagedDocumentSchema = z.object({
  links: managedDocumentInputSchema.shape.links.unwrap(),
  documentType: managedDocumentInputSchema.shape.documentType.unwrap(),
  title: managedDocumentInputSchema.shape.title.unwrap(),
  description: managedDocumentInputSchema.shape.description.default(null),
  mediaType: managedDocumentInputSchema.shape.mediaType.unwrap(),
  sourceDescription: managedDocumentInputSchema.shape.sourceDescription.unwrap(),
  sourceProvenance: managedDocumentSourceProvenanceSchema.optional(),
  content: contentSchema,
  uploadProvenance: managedDocumentInputSchema.shape.uploadProvenance.default(null),
}).strict().superRefine((value,context)=>{
  if(value.sourceProvenance!==undefined&&value.sourceDescription===null)context.addIssue({code:"custom",message:"Document source provenance requires a source description."});
});
export type ManagedDocumentRecord=z.infer<typeof managedDocumentEntitySchema>;
export type ManagedDocumentData=Omit<ManagedDocumentRecord,"displayName"|"currentVersion"|"content"|"contentHash"|"createdAt"|"updatedAt">;
export type ManagedDocumentSummary=Omit<ManagedDocumentRecord,"content">;
export type CreateManagedDocumentInput=z.input<typeof createManagedDocumentSchema>;

export const updateManagedDocumentSchema = z.object({
  documentId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  content: contentSchema,
  changeSummary: z.string().trim().min(1).max(500),
  sourceDescription: z.string().trim().min(1).max(500).optional(),
  sourceProvenance: managedDocumentSourceProvenanceSchema.optional(),
}).strict().superRefine((value,context)=>{
  if((value.sourceDescription===undefined)!==(value.sourceProvenance===undefined))context.addIssue({code:"custom",message:"Document version source description and provenance must be provided together."});
});

const typeLabels: Record<ManagedDocumentType, string> = {
  job_description: "Job Description",
  notes: "Notes",
  interview_prep: "Interview Preparation",
  profile: "Profile",
};

export function documentDisplayName(
  document: Pick<ManagedDocumentData, "documentType" | "title" | "uploadProvenance">,
): string {
  return document.title
    ?? document.uploadProvenance?.originalFilename
    ?? typeLabels[document.documentType];
}

export const documentSummary = (document: ManagedDocumentRecord): DocumentSummary => ({
  id: document.id,
  type: document.documentType,
  title: document.title,
  displayName: document.displayName,
  currentVersion: document.currentVersion,
});

export function profileDocumentFilePath(id: string, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "context-document";
  const suffix = id.replace(/^doc_/, "").slice(0, 8);
  return `${slug}-${suffix}.md`;
}

export function documentIdFromIdentifier(identifier: string): string | null {
  const raw = /^(doc_[0-9a-f-]+)$/i.exec(identifier)?.[1];
  if (raw) return raw;
  return /^document:(doc_[0-9a-f-]+)$/i.exec(identifier)?.[1] ?? null;
}

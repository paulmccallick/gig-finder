import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChangeContext } from "./models";
import type { Persistence } from "./ports";
import { DomainValidationError, MutationError, OptimisticConcurrencyError } from "./errors";

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

export interface DocumentLink {
  entityType: DocumentLinkEntityType;
  entityId: string;
}

export interface DocumentSummary {
  id: string;
  type: ManagedDocumentType;
  title: string | null;
  displayName: string;
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
}

export interface UpdateManagedDocumentInput {
  documentId: string;
  expectedVersion: number;
  content: string;
  changeSummary: string;
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
  content: contentSchema,
  uploadProvenance: managedDocumentInputSchema.shape.uploadProvenance.default(null),
}).strict();
export type ManagedDocumentRecord=z.infer<typeof managedDocumentEntitySchema>;
export type ManagedDocumentData=Omit<ManagedDocumentRecord,"displayName"|"currentVersion"|"content"|"contentHash"|"createdAt"|"updatedAt">;
export type ManagedDocumentSummary=Omit<ManagedDocumentRecord,"content">;
export type CreateManagedDocumentInput=z.input<typeof createManagedDocumentSchema>;

export const updateManagedDocumentSchema = z.object({
  documentId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  content: contentSchema,
  changeSummary: z.string().trim().min(1).max(500),
}).strict();

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

const hashContent = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

const managedSummary = (document: ManagedDocumentRecord): ManagedDocumentSummary => {
  const { content: _, ...result } = document;
  return result;
};

const linkKey = (link: DocumentLink) => `${link.entityType}:${link.entityId}`;

export class ManagedDocumentService {
  constructor(private readonly persistence: Persistence) {}

  get(identifier: string): ManagedDocumentRecord | null {
    const id = documentIdFromIdentifier(identifier);
    return id ? this.persistence.documents.get(id) : null;
  }

  list(entityType: DocumentLinkEntityType, entityId: string): ManagedDocumentSummary[] {
    return this.persistence.documents.list(entityType, entityId).map(managedSummary);
  }

  summaries(entityType: DocumentLinkEntityType, entityId: string): DocumentSummary[] {
    return this.persistence.documents.list(entityType, entityId).map(documentSummary);
  }

  profileContext(): ProfileDocumentContext[] {
    return this.persistence.documents.list("profile", candidateProfileId).map(document => {
      if (!document.title) {
        throw new Error(`Profile context document ${document.id} has no name.`);
      }
      return {
        id: document.id,
        name: document.title,
        type: document.documentType,
        description: document.description,
        currentVersion: document.currentVersion,
      };
    });
  }

  versions(identifier: string): ManagedDocumentVersionData[] {
    const id = documentIdFromIdentifier(identifier);
    return id ? this.persistence.documents.listVersions(id) : [];
  }

  create(
    context: ChangeContext,
    input: CreateManagedDocumentInput,
  ): ManagedDocumentMutationResult {
    const parsed = this.parseCreate(input);
    this.validateLinkContract(parsed.documentType, parsed.links, parsed.title);
    const contentHash = hashContent(parsed.content);
    const id = `doc_${randomUUID()}`;
    const profileOwned = parsed.links.some(link => link.entityType === "profile");
    const profileTitle = profileOwned ? parsed.title : null;
    if (profileOwned && !profileTitle) {
      throw new DomainValidationError("A profile context document requires a name.");
    }
    try {
      const result = this.persistence.change(context, transaction => {
        for (const link of parsed.links) {
          if (link.entityType === "profile") continue;
          const target = link.entityType === "gig"
            ? transaction.gigs.get(link.entityId)
            : transaction.people.get(link.entityId);
          if (!target) {
            throw new MutationError(
              "not_found",
              `${link.entityType === "gig" ? "Gig" : "Person"} not found: ${link.entityId}`,
            );
          }
        }
        return transaction.documents.create({
          document: {
            id,
            links: parsed.links,
            documentType: parsed.documentType,
            title: parsed.title,
            description: parsed.description,
            mediaType: parsed.mediaType,
            sourceDescription: parsed.sourceDescription,
            filePath: profileTitle ? profileDocumentFilePath(id, profileTitle) : null,
            uploadProvenance: parsed.uploadProvenance,
          },
          content: parsed.content,
          contentHash,
        });
      });
      return { document: result.value, changeId: result.changeId, changed: true };
    } catch (error) {
      throw this.translateConcurrency(error);
    }
  }

  update(
    context: ChangeContext,
    input: UpdateManagedDocumentInput,
  ): ManagedDocumentMutationResult {
    const parsed = this.parseUpdate(input);
    const id = documentIdFromIdentifier(parsed.documentId);
    if (!id) {
      throw new DomainValidationError(
        "Document ID must be an exact ID returned by a document tool.",
      );
    }
    const current = this.persistence.documents.get(id);
    if (current?.uploadProvenance) {
      throw new DomainValidationError(
        "Uploaded source documents are immutable and cannot be updated.",
      );
    }
    const contentHash = hashContent(parsed.content);
    if (
      current
      && current.currentVersion === parsed.expectedVersion
      && current.contentHash === contentHash
    ) {
      return { document: current, changeId: null, changed: false };
    }
    try {
      const result = this.persistence.change(context, transaction => {
        const transactionalCurrent = transaction.documents.get(id);
        if (!transactionalCurrent) {
          throw new MutationError("not_found", `Document not found: ${parsed.documentId}`);
        }
        if (transactionalCurrent.currentVersion !== parsed.expectedVersion) {
          throw new MutationError(
            "revision_conflict",
            `Document ${parsed.documentId} expected version ${parsed.expectedVersion} but is at version ${transactionalCurrent.currentVersion}.`,
          );
        }
        return transaction.documents.addVersion({
          documentId: id,
          expectedVersion: parsed.expectedVersion,
          content: parsed.content,
          contentHash,
          changeSummary: parsed.changeSummary,
        });
      });
      return { document: result.value, changeId: result.changeId, changed: true };
    } catch (error) {
      throw this.translateConcurrency(error);
    }
  }

  private validateLinkContract(
    type: ManagedDocumentType,
    links: DocumentLink[],
    title: string | null,
  ) {
    const keys = links.map(linkKey);
    if (new Set(keys).size !== keys.length) {
      throw new DomainValidationError("Document links must be unique.");
    }
    const personLinks = links.filter(link => link.entityType === "person");
    const gigLinks = links.filter(link => link.entityType === "gig");
    const profileLinks = links.filter(link => link.entityType === "profile");
    if (profileLinks.length > 0) {
      if (
        profileLinks.length !== 1
        || profileLinks[0]?.entityId !== candidateProfileId
        || links.length !== 1
      ) {
        throw new DomainValidationError(
          `A profile context document must link only to Profile ${candidateProfileId}.`,
        );
      }
      if (type === "profile") {
        throw new DomainValidationError(
          "A profile context document is not a Person profile document.",
        );
      }
      if (title === null) {
        throw new DomainValidationError("A profile context document requires a name.");
      }
    }
    if (type === "profile" && personLinks.length !== 1) {
      throw new DomainValidationError("A profile must link to exactly one person.");
    }
    if (
      type === "job_description"
      && gigLinks.length === 0
    ) {
      throw new DomainValidationError(
        "A job description must link to at least one gig.",
      );
    }
    if (type === "interview_prep" && gigLinks.length === 0 && profileLinks.length === 0) {
      throw new DomainValidationError(
        "Interview preparation must link to at least one gig or the candidate Profile.",
      );
    }
  }

  private parseCreate(input: CreateManagedDocumentInput) {
    const result = createManagedDocumentSchema.safeParse(input);
    if (!result.success) {
      throw new DomainValidationError(
        result.error.issues.map(issue => issue.message).join("; "),
        { cause: result.error },
      );
    }
    return result.data;
  }

  private parseUpdate(input: UpdateManagedDocumentInput) {
    const result = updateManagedDocumentSchema.safeParse(input);
    if (!result.success) {
      throw new DomainValidationError(
        result.error.issues.map(issue => issue.message).join("; "),
        { cause: result.error },
      );
    }
    return result.data;
  }

  private translateConcurrency(error: unknown): unknown {
    if (error instanceof OptimisticConcurrencyError) {
      return new MutationError("revision_conflict", error.message, { cause: error });
    }
    return error;
  }
}

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChangeContext } from "./models";
import type { Persistence } from "./ports";
import { DomainValidationError, MutationError, OptimisticConcurrencyError } from "./errors";

export const documentLinkEntityTypes = ["job", "person"] as const;
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

export interface ManagedDocumentData {
  id: string;
  links: DocumentLink[];
  documentType: ManagedDocumentType;
  title: string | null;
  mediaType: DocumentMediaType;
  sourceDescription: string | null;
  uploadProvenance: UploadedDocumentProvenance | null;
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

export interface ManagedDocumentRecord extends ManagedDocumentData {
  displayName: string;
  currentVersion: number;
  content: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export type ManagedDocumentSummary = Omit<ManagedDocumentRecord, "content">;

export interface CreateManagedDocumentInput {
  links: DocumentLink[];
  documentType: ManagedDocumentType;
  title: string | null;
  mediaType: DocumentMediaType;
  sourceDescription: string | null;
  content: string;
  uploadProvenance?: UploadedDocumentProvenance | null;
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

export const createManagedDocumentSchema = z.object({
  links: z.array(documentLinkSchema).min(1),
  documentType: z.enum(managedDocumentTypes),
  title: z.string().trim().min(1).max(200).nullable(),
  mediaType: z.enum(documentMediaTypes),
  sourceDescription: z.string().trim().min(1).max(500).nullable(),
  content: contentSchema,
  uploadProvenance: uploadedDocumentProvenanceSchema.nullable().default(null),
}).strict();

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

  versions(identifier: string): ManagedDocumentVersionData[] {
    const id = documentIdFromIdentifier(identifier);
    return id ? this.persistence.documents.listVersions(id) : [];
  }

  create(
    context: ChangeContext,
    input: CreateManagedDocumentInput,
  ): ManagedDocumentMutationResult {
    const parsed = this.parseCreate(input);
    this.validateLinkContract(parsed.documentType, parsed.links);
    const contentHash = hashContent(parsed.content);
    try {
      const result = this.persistence.change(context, transaction => {
        for (const link of parsed.links) {
          const target = link.entityType === "job"
            ? transaction.jobs.get(link.entityId)
            : transaction.people.get(link.entityId);
          if (!target) {
            throw new MutationError(
              "not_found",
              `${link.entityType === "job" ? "Job" : "Person"} not found: ${link.entityId}`,
            );
          }
        }
        return transaction.documents.create({
          document: {
            id: `doc_${randomUUID()}`,
            links: parsed.links,
            documentType: parsed.documentType,
            title: parsed.title,
            mediaType: parsed.mediaType,
            sourceDescription: parsed.sourceDescription,
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

  private validateLinkContract(type: ManagedDocumentType, links: DocumentLink[]) {
    const keys = links.map(linkKey);
    if (new Set(keys).size !== keys.length) {
      throw new DomainValidationError("Document links must be unique.");
    }
    const personLinks = links.filter(link => link.entityType === "person");
    const jobLinks = links.filter(link => link.entityType === "job");
    if (type === "profile" && personLinks.length !== 1) {
      throw new DomainValidationError("A profile must link to exactly one person.");
    }
    if (
      (type === "job_description" || type === "interview_prep")
      && jobLinks.length === 0
    ) {
      throw new DomainValidationError(
        `${type === "job_description" ? "A job description" : "Interview preparation"} must link to at least one job.`,
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

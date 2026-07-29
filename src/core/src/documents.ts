import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChangeContext } from "./models";
import type { Persistence } from "./ports";
import { DomainValidationError, MutationError, OptimisticConcurrencyError } from "./errors";

export const documentOwnerTypes = ["job"] as const;
export type DocumentOwnerType = typeof documentOwnerTypes[number];

export const managedDocumentTypes = [
  "job_description",
  "notes",
  "interview_prep",
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

export interface ManagedDocumentData {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  documentType: ManagedDocumentType;
  title: string;
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
  reference: string;
  currentVersion: number;
  content: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedDocumentSummary extends ManagedDocumentData {
  reference: string;
  currentVersion: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateManagedDocumentInput {
  ownerType: DocumentOwnerType;
  ownerId: string;
  documentType: ManagedDocumentType;
  title: string;
  mediaType: DocumentMediaType;
  sourceDescription: string | null;
  content: string;
  uploadProvenance?: UploadedDocumentProvenance | null;
}

export interface UpdateManagedDocumentInput {
  reference: string;
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

export const createManagedDocumentSchema = z.object({
  ownerType: z.enum(documentOwnerTypes),
  ownerId: z.string().trim().min(1).max(200),
  documentType: z.enum(managedDocumentTypes),
  title: z.string().trim().min(1).max(200),
  mediaType: z.enum(documentMediaTypes),
  sourceDescription: z.string().trim().min(1).max(500).nullable(),
  content: contentSchema,
  uploadProvenance: uploadedDocumentProvenanceSchema.nullable().default(null),
}).strict();

export const updateManagedDocumentSchema = z.object({
  reference: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  content: contentSchema,
  changeSummary: z.string().trim().min(1).max(500),
}).strict();

export const documentReference = (documentId: string) => `document:${documentId}`;

export function documentIdFromReference(reference: string): string | null {
  const match = /^document:(doc_[0-9a-f-]+)$/i.exec(reference);
  return match?.[1] ?? null;
}

const hashContent = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

const summary = (document: ManagedDocumentRecord): ManagedDocumentSummary => {
  const { content: _, ...result } = document;
  return result;
};

export class ManagedDocumentService {
  constructor(private readonly persistence: Persistence) {}

  get(reference: string): ManagedDocumentRecord | null {
    const id = documentIdFromReference(reference);
    return id ? this.persistence.documents.get(id) : null;
  }

  list(
    ownerType: DocumentOwnerType,
    ownerId: string,
  ): ManagedDocumentSummary[] {
    return this.persistence.documents.list(ownerType, ownerId).map(summary);
  }

  versions(reference: string): ManagedDocumentVersionData[] {
    const id = documentIdFromReference(reference);
    return id ? this.persistence.documents.listVersions(id) : [];
  }

  create(
    context: ChangeContext,
    input: CreateManagedDocumentInput,
  ): ManagedDocumentMutationResult {
    const parsed = this.parseCreate(input);
    const contentHash = hashContent(parsed.content);
    try {
      const result = this.persistence.change(context, transaction => {
        if (
          parsed.ownerType === "job"
          && !transaction.jobs.get(parsed.ownerId)
        ) {
          throw new MutationError("not_found", `Job not found: ${parsed.ownerId}`);
        }
        return transaction.documents.create({
          document: {
            id: `doc_${randomUUID()}`,
            ownerType: parsed.ownerType,
            ownerId: parsed.ownerId,
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
    const id = documentIdFromReference(parsed.reference);
    if (!id) {
      throw new DomainValidationError(
        "Document reference must be an exact reference returned by a document tool.",
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
          throw new MutationError(
            "not_found",
            `Document not found: ${parsed.reference}`,
          );
        }
        if (transactionalCurrent.currentVersion !== parsed.expectedVersion) {
          throw new MutationError(
            "revision_conflict",
            `Document ${parsed.reference} expected version ${parsed.expectedVersion} but is at version ${transactionalCurrent.currentVersion}.`,
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

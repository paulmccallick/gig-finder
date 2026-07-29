import { randomUUID } from "node:crypto";
import type { UploadedDocumentProvenance } from "./documents";
import { managedDocumentContentLimit } from "./documents";
import { DomainValidationError } from "./errors";

export const stagedDocumentReferencePattern = /^staged-document:[0-9a-f-]+$/i;

export interface StagedDocument {
  reference: string;
  markdown: string;
  provenance: UploadedDocumentProvenance;
  expiresAt: string;
}

export interface StageDocumentInput {
  markdown: string;
  provenance: UploadedDocumentProvenance;
}

export interface StagedDocumentAccess {
  get(reference: string): StagedDocument | null;
  discard(reference: string): boolean;
}

export class StagedDocumentService implements StagedDocumentAccess {
  private readonly documents = new Map<string, StagedDocument>();

  constructor(
    private readonly lifetimeMs = 15 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  stage(input: StageDocumentInput): StagedDocument {
    if (!input.markdown.trim()) {
      throw new DomainValidationError("Extracted document content cannot be empty.");
    }
    if (input.markdown.length > managedDocumentContentLimit) {
      throw new DomainValidationError(
        `Extracted document content cannot exceed ${managedDocumentContentLimit} characters.`,
      );
    }
    this.removeExpired();
    const reference = `staged-document:${randomUUID()}`;
    const document = {
      reference,
      markdown: input.markdown,
      provenance: input.provenance,
      expiresAt: new Date(this.now().getTime() + this.lifetimeMs).toISOString(),
    };
    this.documents.set(reference, document);
    return document;
  }

  get(reference: string): StagedDocument | null {
    this.removeExpired();
    if (!stagedDocumentReferencePattern.test(reference)) return null;
    return this.documents.get(reference) ?? null;
  }

  discard(reference: string): boolean {
    return this.documents.delete(reference);
  }

  private removeExpired() {
    const now = this.now().getTime();
    for (const [reference, document] of this.documents) {
      if (Date.parse(document.expiresAt) <= now) this.documents.delete(reference);
    }
  }
}

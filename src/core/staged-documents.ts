import { randomUUID } from "node:crypto";
import type {
  ManagedDocumentSummary,
  UploadedDocumentProvenance,
} from "./documents";
import {
  managedDocumentContentLimit,
  uploadedDocumentProvenanceSchema,
} from "./documents";
import { DomainValidationError } from "./errors";

export const stagedDocumentReferencePattern = /^staged-document:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isStagedDocumentReference = (value: string) =>
  stagedDocumentReferencePattern.test(value);

export interface StagedDocument {
  reference: string;
  markdown: string;
  provenance: UploadedDocumentProvenance;
  expiresAt: string;
  consumption: StagedDocumentConsumption | null;
}

export interface StagedDocumentConsumption {
  changed: boolean;
  changeId: string | null;
  document: ManagedDocumentSummary;
}

export interface StageDocumentInput {
  markdown: string;
  provenance: UploadedDocumentProvenance;
}

export interface StagedDocumentAccess {
  get(reference: string): StagedDocument | null;
  consume(
    reference: string,
    result: StagedDocumentConsumption,
  ): StagedDocumentConsumption | null;
  discard(reference: string): boolean;
}

export interface StagedDocumentServiceOptions {
  lifetimeMs?: number;
  maxDocuments?: number;
  maxTotalCharacters?: number;
  now?: () => Date;
}

export class StagedDocumentCapacityError extends Error {}

const defaultLifetimeMs = 15 * 60 * 1000;
const defaultMaxDocuments = 20;
const defaultMaxTotalCharacters = managedDocumentContentLimit * 10;

export class StagedDocumentService implements StagedDocumentAccess {
  private readonly documents = new Map<string, StagedDocument>();
  private readonly lifetimeMs: number;
  private readonly maxDocuments: number;
  private readonly maxTotalCharacters: number;
  private readonly now: () => Date;

  constructor(options: StagedDocumentServiceOptions = {}) {
    this.lifetimeMs = options.lifetimeMs ?? defaultLifetimeMs;
    this.maxDocuments = options.maxDocuments ?? defaultMaxDocuments;
    this.maxTotalCharacters = options.maxTotalCharacters
      ?? defaultMaxTotalCharacters;
    this.now = options.now ?? (() => new Date());
    for (const [name, value] of [
      ["lifetimeMs", this.lifetimeMs],
      ["maxDocuments", this.maxDocuments],
      ["maxTotalCharacters", this.maxTotalCharacters],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer.`);
      }
    }
  }

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
    const stagedCharacters = [...this.documents.values()]
      .reduce((total, document) => total + document.markdown.length, 0);
    if (
      this.documents.size >= this.maxDocuments
      || stagedCharacters + input.markdown.length > this.maxTotalCharacters
    ) {
      throw new StagedDocumentCapacityError(
        "Staged document capacity is full. Discard an attachment or try again after an existing attachment expires.",
      );
    }
    const provenance = uploadedDocumentProvenanceSchema.safeParse(input.provenance);
    if (!provenance.success) {
      throw new DomainValidationError(
        "Uploaded document provenance is invalid.",
        { cause: provenance.error },
      );
    }
    const reference = `staged-document:${randomUUID()}`;
    const document = {
      reference,
      markdown: input.markdown,
      provenance: provenance.data,
      expiresAt: new Date(this.now().getTime() + this.lifetimeMs).toISOString(),
      consumption: null,
    };
    this.documents.set(reference, document);
    return document;
  }

  consume(
    reference: string,
    result: StagedDocumentConsumption,
  ): StagedDocumentConsumption | null {
    const document = this.get(reference);
    if (!document) return null;
    if (document.consumption) return document.consumption;
    document.consumption = result;
    return result;
  }

  get(reference: string): StagedDocument | null {
    this.removeExpired();
    if (!isStagedDocumentReference(reference)) return null;
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

import type { ManagedDocumentService, ManagedDocumentType } from "./documents";
import type { GigRecord } from "./gigs";
import type { ReadResult } from "./queries";

export type ReadableDocumentType = ManagedDocumentType;

interface DocumentReferenceBase {
  reference: string;
  entityType: "gig" | "person";
  entityId: string;
  documentType: ReadableDocumentType;
  title: string | null;
  displayName: string;
}

export type DocumentReference = DocumentReferenceBase & (
  | { storage: "artifact"; currentVersion: null }
  | { storage: "managed"; currentVersion: number }
);

export type ReadableDocument = DocumentReference & {
  content: string;
  truncated: boolean;
  totalCharacters: number;
};

export const readableDocumentContentLimit = 50_000;

export interface DocumentReader {
  list(entityType: "gig" | "person", entityId: string): Promise<DocumentReference[]>;
  get(reference: string): Promise<ReadResult<ReadableDocument>>;
}

export interface DocumentReaderServices {
  gigs: {
    get(id: string): GigRecord | null;
    description(id: string): Promise<string | null>;
    prep(id: string): Promise<Array<{ name: string; content: string }>>;
  };
  people: { get(id: string): unknown | null };
  managed?: Pick<ManagedDocumentService, "get" | "list">;
}

const encoded = (value: string) => encodeURIComponent(value);
const decoded = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export class ApplicationDocumentReader implements DocumentReader {
  constructor(private readonly services: DocumentReaderServices) {}

  async list(
    entityType: "gig" | "person",
    entityId: string,
  ): Promise<DocumentReference[]> {
    if (entityType === "person") {
      return (this.services.people.get(entityId) ? this.services.managed?.list("person", entityId) ?? [] : [])
        .map(document => ({
          reference: document.id,
          entityType,
          entityId,
          documentType: document.documentType,
          title: document.title,
          displayName: document.displayName,
          storage: "managed" as const,
          currentVersion: document.currentVersion,
        }));
    }

    const gig = this.services.gigs.get(entityId);
    if (!gig) return [];
    const references: DocumentReference[] = [];
    if (gig.hasJobDescription) {
      references.push({
        reference: `gig:${encoded(entityId)}:job_description`,
        entityType,
        entityId,
        documentType: "job_description",
        title: "Job description",
        displayName: "Gig Description",
        storage: "artifact",
        currentVersion: null,
      });
    }
    if (gig.hasInterviewPrep) {
      for (const document of await this.services.gigs.prep(entityId)) {
        references.push({
          reference: `gig:${encoded(entityId)}:interview_prep:${encoded(document.name)}`,
          entityType,
          entityId,
          documentType: "interview_prep",
          title: document.name,
          displayName: document.name,
          storage: "artifact",
          currentVersion: null,
        });
      }
    }
    for (const document of this.services.managed?.list("gig", entityId) ?? []) {
      references.push({
        reference: document.id,
        entityType,
        entityId,
        documentType: document.documentType,
        title: document.title,
        displayName: document.displayName,
        storage: "managed",
        currentVersion: document.currentVersion,
      });
    }
    return references;
  }

  async get(reference: string): Promise<ReadResult<ReadableDocument>> {
    if (reference.startsWith("doc_") || reference.startsWith("document:")) {
      const managed = this.services.managed?.get(reference) ?? null;
      const primaryLink = managed?.links[0];
      return managed && primaryLink
        ? {
            status: "ok",
            record: documentRecord({
              reference: managed.id,
              entityType: primaryLink.entityType,
              entityId: primaryLink.entityId,
              documentType: managed.documentType,
              title: managed.title,
              displayName: managed.displayName,
              storage: "managed",
              currentVersion: managed.currentVersion,
            }, managed.content),
          }
        : { status: "not_found", id: reference };
    }

    const parts = reference.split(":");
    const entityType = parts[0];
    const entityId = parts[1] ? decoded(parts[1]) : null;
    const documentType = parts[2];
    if (!entityId || (entityType !== "gig" && entityType !== "person")) {
      return { status: "not_found", id: reference };
    }
    const match = (await this.list(entityType, entityId))
      .find(item => item.reference === reference);
    if (!match) return { status: "not_found", id: reference };
    if (documentType === "job_description") {
      const content = await this.services.gigs.description(entityId);
      return content === null
        ? { status: "not_found", id: reference }
        : { status: "ok", record: documentRecord(match, content) };
    }
    const title = parts[3] ? decoded(parts[3]) : null;
    const document = title
      ? (await this.services.gigs.prep(entityId)).find(item => item.name === title)
      : null;
    return document
      ? { status: "ok", record: documentRecord(match, document.content) }
      : { status: "not_found", id: reference };
  }
}

function documentRecord(reference: DocumentReference, content: string): ReadableDocument {
  return {
    ...reference,
    content: content.slice(0, readableDocumentContentLimit),
    truncated: content.length > readableDocumentContentLimit,
    totalCharacters: content.length,
  };
}

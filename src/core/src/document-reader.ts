import type { ManagedDocumentService, ManagedDocumentType } from "./documents";
import type { JobRecord } from "./jobs";
import type { ReadResult } from "./queries";

export type ReadableDocumentType = ManagedDocumentType | "contact_profile";

interface DocumentReferenceBase {
  reference: string;
  entityType: "job" | "contact";
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
  list(entityType: "job" | "contact", entityId: string): Promise<DocumentReference[]>;
  get(reference: string): Promise<ReadResult<ReadableDocument>>;
}

export interface DocumentReaderServices {
  jobs: {
    get(id: string): JobRecord | null;
    description(id: string): Promise<string | null>;
    prep(id: string): Promise<Array<{ name: string; content: string }>>;
  };
  contacts: { personId(id: string): string | null };
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
    entityType: "job" | "contact",
    entityId: string,
  ): Promise<DocumentReference[]> {
    if (entityType === "contact") {
      const personId = this.services.contacts.personId(entityId);
      return (personId ? this.services.managed?.list("person", personId) ?? [] : [])
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

    const job = this.services.jobs.get(entityId);
    if (!job) return [];
    const references: DocumentReference[] = [];
    if (job.hasJobDescription) {
      references.push({
        reference: `job:${encoded(entityId)}:job_description`,
        entityType,
        entityId,
        documentType: "job_description",
        title: "Job description",
        displayName: "Job Description",
        storage: "artifact",
        currentVersion: null,
      });
    }
    if (job.hasInterviewPrep) {
      for (const document of await this.services.jobs.prep(entityId)) {
        references.push({
          reference: `job:${encoded(entityId)}:interview_prep:${encoded(document.name)}`,
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
    for (const document of this.services.managed?.list("job", entityId) ?? []) {
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
              entityType: primaryLink.entityType === "job" ? "job" : "contact",
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
    if (!entityId || (entityType !== "job" && entityType !== "contact")) {
      return { status: "not_found", id: reference };
    }
    const match = (await this.list(entityType, entityId))
      .find(item => item.reference === reference);
    if (!match) return { status: "not_found", id: reference };
    if (documentType === "job_description") {
      const content = await this.services.jobs.description(entityId);
      return content === null
        ? { status: "not_found", id: reference }
        : { status: "ok", record: documentRecord(match, content) };
    }
    const title = parts[3] ? decoded(parts[3]) : null;
    const document = title
      ? (await this.services.jobs.prep(entityId)).find(item => item.name === title)
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

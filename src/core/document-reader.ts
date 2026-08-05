import type { ManagedDocumentService, ManagedDocumentType } from "./documents";
import { createHash } from "node:crypto";
import type { GigRecord } from "./gigs";
import { page, type Page, type ReadResult } from "./queries";
import { candidateProfileId, documentIdFromIdentifier, type DocumentLinkEntityType, type DocumentMediaType, type UploadedDocumentProvenance } from "./documents";

export type ReadableDocumentType = ManagedDocumentType;

interface DocumentReferenceBase {
  reference: string;
  entityType: "gig" | "person" | "profile";
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
  version: number | null;
  content: string;
  truncated: boolean;
  totalCharacters: number;
};

export const readableDocumentContentLimit = 50_000;

export interface DocumentReader {
  list(entityType: "gig" | "person" | "profile", entityId: string): Promise<DocumentReference[]>;
  query(input: DocumentDiscoveryInput): Promise<DocumentDiscoveryResult>;
  versionQuery(input: DocumentVersionQueryInput): DocumentVersionDiscoveryResult;
  get(reference: string, version?: number | null): Promise<ReadResult<ReadableDocument>>;
}

export interface DocumentDiscoveryInput { owner: { entityType: DocumentLinkEntityType; entityId: string }; offset?: number; limit?: number }
export type DocumentDiscoveryResult = ({status:"ok"} & Page<DocumentReference>) | {status:"not_found";id:string} | {status:"unsupported";id:string;message:string};
export interface DocumentVersionQueryInput { documentId: string; offset?: number; limit?: number }
export interface DocumentVersionMetadata { documentId:string;version:number;parentVersion:number|null;contentHash:string;changeId:string;changeSummary:string;createdAt:string;createdBy:string;mediaType:DocumentMediaType;provenance:UploadedDocumentProvenance|null }
export type DocumentVersionDiscoveryResult =
  | {status:"ok"} & Page<DocumentVersionMetadata>
  | {status:"not_found";id:string}
  | {status:"unsupported";id:string;message:string};

export interface DocumentReaderServices {
  gigs: {
    get(id: string): GigRecord | null;
    description(id: string): Promise<string | null>;
    prep(id: string): Promise<Array<{ name: string; content: string }>>;
  };
  people: { get(id: string): unknown | null };
  managed?: Pick<ManagedDocumentService, "get" | "list" | "versions">;
}

const encoded = (value: string) => encodeURIComponent(value);
const contentHash=(value:string)=>createHash("sha256").update(value).digest("hex");
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
    entityType: "gig" | "person" | "profile",
    entityId: string,
  ): Promise<DocumentReference[]> {
    if (entityType === "profile") {
      return (this.services.managed?.list("profile", entityId) ?? []).map(document => ({
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
    const managedDocuments=this.services.managed?.list("gig",entityId)??[];
    const managedDescriptions=managedDocuments.filter(document=>document.documentType==="job_description");
    const legacyDescription=gig.hasJobDescription?await this.services.gigs.description(entityId):null;
    if (legacyDescription!==null&&!managedDescriptions.some(document=>document.contentHash===contentHash(legacyDescription))) {
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
        if(managedDocuments.some(managed=>managed.documentType==="interview_prep"&&managed.title===document.name&&managed.contentHash===contentHash(document.content)))continue;
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
    for (const document of managedDocuments) {
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

  async query(input: DocumentDiscoveryInput): Promise<DocumentDiscoveryResult> {
    const {entityType,entityId}=input.owner;
    const exists=entityType==="profile"
      ?entityId===candidateProfileId
      :entityType==="gig"?this.services.gigs.get(entityId)!==null:this.services.people.get(entityId)!==null;
    if(!exists)return{status:"not_found",id:`${entityType}:${entityId}`};
    const items=(await this.list(entityType,entityId)).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.reference.localeCompare(b.reference));
    return{status:"ok",...page(items,input)};
  }

  versionQuery(input: DocumentVersionQueryInput): DocumentVersionDiscoveryResult {
    const id=documentIdFromIdentifier(input.documentId);
    if(!id)return{status:"unsupported",id:input.documentId,message:"Only managed documents have version history."};
    const document=this.services.managed?.get(id);
    if(!document)return{status:"not_found",id:input.documentId};
    const versions=(this.services.managed?.versions(id)??[]).map(({content:_,...version})=>({
      ...version,mediaType:document.mediaType,provenance:document.uploadProvenance,
    })).sort((a,b)=>b.version-a.version);
    return{status:"ok",...page(versions,input)};
  }

  async get(reference: string, version?: number | null): Promise<ReadResult<ReadableDocument>> {
    if (reference.startsWith("doc_") || reference.startsWith("document:")) {
      const managed = this.services.managed?.get(reference) ?? null;
      const primaryLink = managed?.links[0];
      const selected = version === undefined || version === null
        ? managed
        : this.services.managed?.versions(reference).find(item => item.version === version) ?? null;
      return managed && primaryLink
        && selected
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
            }, selected.content, version ?? managed.currentVersion),
          }
        : { status: "not_found", id: reference };
    }

    const parts = reference.split(":");
    const entityType = parts[0];
    const entityId = parts[1] ? decoded(parts[1]) : null;
    const documentType = parts[2];
    if (!entityId || !["gig", "person", "profile"].includes(entityType ?? "")) {
      return { status: "not_found", id: reference };
    }
    const match = (await this.list(entityType as "gig" | "person" | "profile", entityId))
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

function documentRecord(
  reference: DocumentReference,
  content: string,
  version = reference.currentVersion,
): ReadableDocument {
  return {
    ...reference,
    version,
    content: content.slice(0, readableDocumentContentLimit),
    truncated: content.length > readableDocumentContentLimit,
    totalCharacters: content.length,
  };
}

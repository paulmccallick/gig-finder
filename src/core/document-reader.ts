import type { ManagedDocumentType } from "./documents";
import type { ManagedDocumentService } from "./managed-document-service";
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

export type DocumentReference = DocumentReferenceBase & {
  storage: "managed";
  currentVersion: number;
};

export type ReadableDocument = DocumentReference & {
  mediaType: DocumentMediaType;
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
  gigs: { get(id: string): unknown | null };
  people: { get(id: string): unknown | null };
  managed?: Pick<ManagedDocumentService, "get" | "list" | "versions">;
}

type ManagedDocumentListing = ReturnType<ManagedDocumentService["list"]>[number];
const toReference = (
  document: ManagedDocumentListing,
  owner: DocumentDiscoveryInput["owner"],
): DocumentReference => {
  return {
    reference: document.id,
    entityType: owner.entityType,
    entityId: owner.entityId,
    documentType: document.documentType,
    title: document.title,
    displayName: document.displayName,
    storage: "managed",
    currentVersion: document.currentVersion,
  };
};

export class ApplicationDocumentReader implements DocumentReader {
  constructor(private readonly services: DocumentReaderServices) {}

  async list(
    entityType: "gig" | "person" | "profile",
    entityId: string,
  ): Promise<DocumentReference[]> {
    if (entityType === "profile") {
      return (this.services.managed?.list("profile", entityId) ?? [])
        .map(document => toReference(document, { entityType, entityId }));
    }
    if (entityType === "person") {
      return (this.services.people.get(entityId) ? this.services.managed?.list("person", entityId) ?? [] : [])
        .map(document => toReference(document, { entityType, entityId }));
    }

    const gig = this.services.gigs.get(entityId);
    if (!gig) return [];
    return (this.services.managed?.list("gig", entityId) ?? [])
      .map(document => toReference(document, { entityType, entityId }));
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
    if (reference.startsWith("doc_")) {
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
            }, selected.content, managed.mediaType, version ?? managed.currentVersion),
          }
        : { status: "not_found", id: reference };
    }
    return { status: "not_found", id: reference };
  }
}

function documentRecord(
  reference: DocumentReference,
  content: string,
  mediaType: DocumentMediaType,
  version = reference.currentVersion,
): ReadableDocument {
  return {
    ...reference,
    mediaType,
    version,
    content: content.slice(0, readableDocumentContentLimit),
    truncated: content.length > readableDocumentContentLimit,
    totalCharacters: content.length,
  };
}

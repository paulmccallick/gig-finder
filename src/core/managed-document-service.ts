import { createHash, randomUUID } from "node:crypto";
import {
  candidateProfileId,
  createManagedDocumentSchema,
  documentIdFromIdentifier,
  documentSummary,
  profileDocumentFilePath,
  updateManagedDocumentSchema,
  type CreateManagedDocumentInput,
  type DocumentLink,
  type DocumentLinkEntityType,
  type DocumentSummary,
  type ManagedDocumentMutationResult,
  type ManagedDocumentRecord,
  type ManagedDocumentSummary,
  type ManagedDocumentType,
  type ManagedDocumentVersionData,
  type ProfileDocumentContext,
  type UpdateManagedDocumentInput,
} from "./documents";
import { DomainValidationError, MutationError, OptimisticConcurrencyError } from "./errors";
import type { ChangeContext } from "./models";
import type { Persistence } from "./ports";

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

  createdByChange(changeId:string):ManagedDocumentRecord|null {
    return this.persistence.documents.createdByChange(changeId);
  }

  list(entityType: DocumentLinkEntityType, entityId: string): ManagedDocumentSummary[] {
    return this.persistence.documents.list(entityType, entityId).map(managedSummary);
  }

  summaries(entityType: DocumentLinkEntityType, entityId: string): DocumentSummary[] {
    return this.persistence.documents.list(entityType, entityId).map(documentSummary);
  }

  profileContext(): ProfileDocumentContext[] {
    return this.persistence.documents.list("profile", candidateProfileId).map(document => {
      if (!document.title) throw new Error(`Profile context document ${document.id} has no name.`);
      return { id: document.id, name: document.title, type: document.documentType, description: document.description, currentVersion: document.currentVersion };
    });
  }

  versions(identifier: string): ManagedDocumentVersionData[] {
    const id = documentIdFromIdentifier(identifier);
    return id ? this.persistence.documents.listVersions(id) : [];
  }

  create(context: ChangeContext, input: CreateManagedDocumentInput): ManagedDocumentMutationResult {
    const parsed = this.parseCreate(input);
    this.validateLinkContract(parsed.documentType, parsed.links, parsed.title);
    const contentHash = hashContent(parsed.content);
    const id = `doc_${randomUUID()}`;
    const profileOwned = parsed.links.some(link => link.entityType === "profile");
    const profileTitle = profileOwned ? parsed.title : null;
    if (profileOwned && !profileTitle) throw new DomainValidationError("A profile context document requires a name.");
    try {
      const result = this.persistence.change(context, transaction => {
        for (const link of parsed.links) {
          if (link.entityType === "profile") continue;
          const target = link.entityType === "gig" ? transaction.gigs.get(link.entityId) : transaction.people.get(link.entityId);
          if (!target) throw new MutationError("not_found", `${link.entityType === "gig" ? "Gig" : "Person"} not found: ${link.entityId}`);
        }
        return transaction.documents.create({
          document: { id, links: parsed.links, documentType: parsed.documentType, title: parsed.title, description: parsed.description, mediaType: parsed.mediaType, sourceDescription: parsed.sourceDescription, filePath: profileTitle ? profileDocumentFilePath(id, profileTitle) : null, uploadProvenance: parsed.uploadProvenance },
          content: parsed.content,
          contentHash,
        });
      });
      return { document: result.value, changeId: result.changeId, changed: true };
    } catch (error) {
      throw this.translateConcurrency(error);
    }
  }

  update(context: ChangeContext, input: UpdateManagedDocumentInput): ManagedDocumentMutationResult {
    const parsed = this.parseUpdate(input);
    const id = documentIdFromIdentifier(parsed.documentId);
    if (!id) throw new DomainValidationError("Document ID must be an exact ID returned by a document tool.");
    const current = this.persistence.documents.get(id);
    if (current?.uploadProvenance) throw new DomainValidationError("Uploaded source documents are immutable and cannot be updated.");
    const contentHash = hashContent(parsed.content);
    if (current && current.currentVersion === parsed.expectedVersion && current.contentHash === contentHash) return { document: current, changeId: null, changed: false };
    try {
      const result = this.persistence.change(context, transaction => {
        const transactionalCurrent = transaction.documents.get(id);
        if (!transactionalCurrent) throw new MutationError("not_found", `Document not found: ${parsed.documentId}`);
        if (transactionalCurrent.currentVersion !== parsed.expectedVersion) throw new MutationError("revision_conflict", `Document ${parsed.documentId} expected version ${parsed.expectedVersion} but is at version ${transactionalCurrent.currentVersion}.`);
        return transaction.documents.addVersion({ documentId: id, expectedVersion: parsed.expectedVersion, content: parsed.content, contentHash, changeSummary: parsed.changeSummary });
      });
      return { document: result.value, changeId: result.changeId, changed: true };
    } catch (error) {
      throw this.translateConcurrency(error);
    }
  }

  private validateLinkContract(type: ManagedDocumentType, links: DocumentLink[], title: string | null) {
    const keys = links.map(linkKey);
    if (new Set(keys).size !== keys.length) throw new DomainValidationError("Document links must be unique.");
    const personLinks = links.filter(link => link.entityType === "person");
    const gigLinks = links.filter(link => link.entityType === "gig");
    const profileLinks = links.filter(link => link.entityType === "profile");
    if (profileLinks.length > 0) {
      if (profileLinks.length !== 1 || profileLinks[0]?.entityId !== candidateProfileId || links.length !== 1) throw new DomainValidationError(`A profile context document must link only to Profile ${candidateProfileId}.`);
      if (type === "profile") throw new DomainValidationError("A profile context document is not a Person profile document.");
      if (title === null) throw new DomainValidationError("A profile context document requires a name.");
    }
    if (type === "profile" && personLinks.length !== 1) throw new DomainValidationError("A profile must link to exactly one person.");
    if (type === "job_description" && gigLinks.length === 0) throw new DomainValidationError("A job description must link to at least one gig.");
    if (type === "interview_prep" && gigLinks.length === 0 && profileLinks.length === 0) throw new DomainValidationError("Interview preparation must link to at least one gig or the candidate Profile.");
  }

  private parseCreate(input: CreateManagedDocumentInput) {
    const result = createManagedDocumentSchema.safeParse(input);
    if (!result.success) throw new DomainValidationError(result.error.issues.map(issue => issue.message).join("; "), { cause: result.error });
    return result.data;
  }

  private parseUpdate(input: UpdateManagedDocumentInput) {
    const result = updateManagedDocumentSchema.safeParse(input);
    if (!result.success) throw new DomainValidationError(result.error.issues.map(issue => issue.message).join("; "), { cause: result.error });
    return result.data;
  }

  private translateConcurrency(error: unknown): unknown {
    if (error instanceof OptimisticConcurrencyError) return new MutationError("revision_conflict", error.message, { cause: error });
    return error;
  }
}

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  createManagedDocumentSchema,
  type ManagedDocumentData,
  type ManagedDocumentType,
} from "../core/documents";
import { LocalArtifactStore } from "./artifacts";
import { DataStore } from "./store";

const migrationChangeId = "migration:legacy-gig-artifacts:v1";
const migrationSourceDescription = "Imported from a registered legacy Gig artifact.";

interface LegacyDocument {
  gigId: string;
  documentType: Extract<ManagedDocumentType, "job_description" | "interview_prep">;
  title: string;
  content: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const documentId = (document: LegacyDocument) =>
  `doc_legacy_${hash(`${document.gigId}\0${document.documentType}\0${document.title}`).slice(0, 32)}`;

async function registeredDocuments(store: DataStore, artifactsRoot: string) {
  const artifacts = new LocalArtifactStore(artifactsRoot);
  const documents: LegacyDocument[] = [];
  for (const gig of store.gigs.list({includeDeleted:true})) {
    if (gig.hasJobDescription) {
      let content:string;
      try{content=await artifacts.jobDescription(gig.id);}catch(error){throw new Error(`Registered job-description artifact is missing or unreadable for Gig ${gig.id}.`,{cause:error});}
      documents.push({
        gigId: gig.id,
        documentType: "job_description",
        title: "Gig Description",
        content,
      });
    }
    if (gig.hasInterviewPrep) {
      const prep = await artifacts.interviewPrep(gig.id);
      if (prep.length === 0) {
        throw new Error(`Registered interview-prep artifacts are missing for Gig ${gig.id}.`);
      }
      documents.push(...prep.map(item => ({
        gigId: gig.id,
        documentType: "interview_prep" as const,
        title: item.name,
        content: item.content,
      })));
    }
  }
  return documents;
}

/** Imports registered legacy Gig artifacts after SQL migrations and before validation. */
export async function migrateLegacyGigArtifacts(
  database: Database,
  artifactsRoot: string,
): Promise<{ imported: number; existing: number }> {
  const store = new DataStore(database);
  if (store.hasChange(migrationChangeId)) return { imported: 0, existing: 0 };
  const legacy = await registeredDocuments(store, artifactsRoot);
  const pending: Array<{ document: ManagedDocumentData; content: string; contentHash: string }> = [];
  let existing = 0;

  for (const item of legacy) {
    const parsed = createManagedDocumentSchema.parse({
      links: [{ entityType: "gig", entityId: item.gigId }],
      documentType: item.documentType,
      title: item.title,
      description: null,
      mediaType: "text/markdown",
      sourceDescription: migrationSourceDescription,
      content: item.content,
      uploadProvenance: null,
    });
    const contentHash = hash(parsed.content);
    const equivalent = store.documents.list("gig", item.gigId).find(document =>
      document.documentType === parsed.documentType
      && document.title === parsed.title
      && document.contentHash === contentHash);
    if (equivalent) {
      existing += 1;
      continue;
    }
    const id = documentId(item);
    const collision = store.documents.get(id);
    if (collision) {
      throw new Error(`Legacy artifact document ID ${id} is already used by different content.`);
    }
    pending.push({
      document: {
        id,
        links: parsed.links,
        documentType: parsed.documentType,
        title: parsed.title,
        description: parsed.description,
        mediaType: parsed.mediaType,
        sourceDescription: parsed.sourceDescription,
        filePath: null,
        uploadProvenance: parsed.uploadProvenance,
      },
      content: parsed.content,
      contentHash,
    });
  }

  store.change({
    actor: "GigFinder migration",
    source: "import",
    summary: "Import registered legacy Gig artifacts as managed documents",
    changeId: migrationChangeId,
  }, transaction => {
    for (const input of pending) transaction.documents.create(input);
  });
  return { imported: pending.length, existing };
}

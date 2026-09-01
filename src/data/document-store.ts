import type { Database } from "bun:sqlite";
import {
  documentDisplayName,
  managedDocumentSourceProvenanceSchema,
  uploadedDocumentProvenanceSchema,
} from "../core/documents";
import type {
  DocumentLink,
  DocumentLinkEntityType,
  ManagedDocumentData,
  ManagedDocumentRecord,
  ManagedDocumentSourceProvenance,
  ManagedDocumentVersionData,
} from "../core/documents";
import type {
  ChangeContext,
} from "../core/models";
import type {
  DocumentReadRepository,
  DocumentWriteRepository,
} from "../core/ports";
import { PersistenceConsistencyError } from "../core/errors";
import { NotFoundError, RevisionConflictError } from "./errors";

type DocumentRow = {
  id: string;
  document_type: ManagedDocumentData["documentType"];
  title: string | null;
  description: string | null;
  media_type: ManagedDocumentData["mediaType"];
  source_description: string | null;
  file_path: string | null;
  materialized_version: number | null;
  upload_provenance_json: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
  content: string;
  content_hash: string;
};

type VersionRow = {
  document_id: string;
  version: number;
  parent_version: number | null;
  content: string;
  content_hash: string;
  change_id: string;
  change_summary: string;
  created_at: string;
  created_by: string;
  source_description: string | null;
  source_provenance_json: string | null;
};

const timestamp = (context: ChangeContext) =>
  context.occurredAt ?? new Date().toISOString();

const fromRow = (row: DocumentRow, links: DocumentLink[]): ManagedDocumentRecord => {
  const document = {
    id: row.id,
    links,
    documentType: row.document_type,
    title: row.title,
    description: row.description,
    mediaType: row.media_type,
    sourceDescription: row.source_description,
    filePath: row.file_path,
    uploadProvenance: row.upload_provenance_json
      ? uploadedDocumentProvenanceSchema.parse(JSON.parse(row.upload_provenance_json))
      : null,
  };
  return {
    ...document,
    displayName: documentDisplayName(document),
    currentVersion: row.current_version,
    content: row.content,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const versionFromRow = (row: VersionRow): ManagedDocumentVersionData => ({
  documentId: row.document_id,
  version: row.version,
  parentVersion: row.parent_version,
  content: row.content,
  contentHash: row.content_hash,
  changeId: row.change_id,
  changeSummary: row.change_summary,
  createdAt: row.created_at,
  createdBy: row.created_by,
  sourceDescription: row.source_description,
  sourceProvenance: row.source_provenance_json
    ? managedDocumentSourceProvenanceSchema.parse(JSON.parse(row.source_provenance_json))
    : null,
});

const selectCurrent = `
  SELECT d.*, v.content, v.content_hash
  FROM managed_documents d
  JOIN managed_document_versions v
    ON v.document_id = d.id AND v.version = d.current_version
`;

export class SqliteDocumentReadRepository implements DocumentReadRepository {
  constructor(protected readonly database: Database) {}

  get(id: string): ManagedDocumentRecord | null {
    const row = this.database.query(`${selectCurrent} WHERE d.id = ?`)
      .get(id) as DocumentRow | null;
    return row ? fromRow(row, this.links(id)) : null;
  }

  createdByChange(changeId:string):ManagedDocumentRecord|null {
    const row=this.database.query(`${selectCurrent} WHERE EXISTS(SELECT 1 FROM managed_document_versions created WHERE created.document_id=d.id AND created.version=1 AND created.change_id=?)`).get(changeId) as DocumentRow|null;
    return row?fromRow(row,this.links(row.id)):null;
  }

  versionByChange(changeId:string):ManagedDocumentVersionData|null {
    const rows=this.database.query(`SELECT * FROM managed_document_versions WHERE change_id=? ORDER BY document_id,version LIMIT 2`).all(changeId) as VersionRow[];
    if(rows.length>1)throw new Error(`Managed document change ${changeId} created multiple versions.`);
    return rows[0]?versionFromRow(rows[0]):null;
  }

  list(
    entityType: DocumentLinkEntityType,
    entityId: string,
  ): ManagedDocumentRecord[] {
    const targetColumn = entityType === "gig"
      ? "gig_id"
      : entityType === "person"
        ? "person_id"
        : "profile_id";
    const rows = this.database.query(
      `${selectCurrent}
       JOIN managed_document_links l ON l.document_id = d.id
       WHERE l.${targetColumn} = ?
       ORDER BY d.document_type, COALESCE(d.title, ''), d.id`,
    ).all(entityId) as DocumentRow[];
    return rows.map(row => fromRow(row, this.links(row.id)));
  }

  listVersions(id: string): ManagedDocumentVersionData[] {
    const rows = this.database.query(
      `SELECT * FROM managed_document_versions
       WHERE document_id = ? ORDER BY version DESC`,
    ).all(id) as VersionRow[];
    return rows.map(versionFromRow);
  }

  listPendingProfileMaterializations(): ManagedDocumentRecord[] {
    const rows = this.database.query(
      `${selectCurrent}
       JOIN managed_document_links l ON l.document_id = d.id
       WHERE l.profile_id IS NOT NULL
         AND d.file_path IS NOT NULL
         AND (d.materialized_version IS NULL OR d.materialized_version <> d.current_version)
       ORDER BY d.id`,
    ).all() as DocumentRow[];
    return rows.map(row => fromRow(row, this.links(row.id)));
  }

  markProfileMaterialized(id: string, version: number): void {
    const result = this.database.query(
      `UPDATE managed_documents
       SET materialized_version = ?
       WHERE id = ? AND current_version = ? AND file_path IS NOT NULL`,
    ).run(version, id, version);
    if (result.changes !== 1) {
      throw new Error(
        `Profile document ${id} changed before version ${version} could be marked materialized.`,
      );
    }
  }

  private links(documentId: string): DocumentLink[] {
    const rows = this.database.query(
      `SELECT id, gig_id, person_id, profile_id FROM managed_document_links
       WHERE document_id = ? ORDER BY profile_id, person_id, gig_id`,
    ).all(documentId) as Array<{
      id: number;
      gig_id: string | null;
      person_id: string | null;
      profile_id: string | null;
    }>;
    return rows.map(row => {
      const targets = [
        row.gig_id ? { entityType: "gig" as const, entityId: row.gig_id } : null,
        row.person_id ? { entityType: "person" as const, entityId: row.person_id } : null,
        row.profile_id ? { entityType: "profile" as const, entityId: row.profile_id } : null,
      ].filter((target): target is DocumentLink => target !== null);
      const [target] = targets;
      if (!target || targets.length !== 1) {
        throw new PersistenceConsistencyError(
          `Managed document link ${row.id} for document ${documentId} has ${targets.length} targets; expected exactly one.`,
        );
      }
      return target;
    });
  }
}

export class SqliteDocumentWriteRepository
  extends SqliteDocumentReadRepository
  implements DocumentWriteRepository {
  constructor(
    database: Database,
    private readonly context: ChangeContext,
    private readonly changeId: string,
  ) {
    super(database);
  }

  create(input: {
    document: ManagedDocumentData;
    content: string;
    contentHash: string;
    sourceProvenance?: ManagedDocumentSourceProvenance;
  }): ManagedDocumentRecord {
    if (this.get(input.document.id)) {
      throw new Error(`Document already exists: ${input.document.id}`);
    }
    const occurredAt = timestamp(this.context);
    this.database.query(
      `INSERT INTO managed_documents (
        id, document_type, title, description, media_type,
        source_description, file_path, materialized_version,
        upload_provenance_json, current_version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
    ).run(
      input.document.id,
      input.document.documentType,
      input.document.title,
      input.document.description,
      input.document.mediaType,
      input.document.sourceDescription,
      input.document.filePath,
      input.document.uploadProvenance
        ? JSON.stringify(input.document.uploadProvenance)
        : null,
      occurredAt,
      occurredAt,
    );
    for (const link of input.document.links) {
      this.database.query(
        `INSERT INTO managed_document_links (document_id, gig_id, person_id, profile_id)
         VALUES (?, ?, ?, ?)`,
      ).run(
        input.document.id,
        link.entityType === "gig" ? link.entityId : null,
        link.entityType === "person" ? link.entityId : null,
        link.entityType === "profile" ? link.entityId : null,
      );
    }
    this.insertVersion({
      documentId: input.document.id,
      version: 1,
      parentVersion: null,
      content: input.content,
      contentHash: input.contentHash,
      changeSummary: this.context.summary,
      sourceDescription: input.sourceProvenance ? input.document.sourceDescription ?? undefined : undefined,
      sourceProvenance: input.sourceProvenance,
    });
    return this.get(input.document.id)!;
  }

  addVersion(input: {
    documentId: string;
    expectedVersion: number;
    content: string;
    contentHash: string;
    changeSummary: string;
    sourceDescription?: string;
    sourceProvenance?: ManagedDocumentSourceProvenance;
  }): ManagedDocumentRecord {
    const current = this.get(input.documentId);
    if (!current) throw new NotFoundError("document", input.documentId);
    if (current.currentVersion !== input.expectedVersion) {
      throw new RevisionConflictError(
        "document",
        input.documentId,
        input.expectedVersion,
        current.currentVersion,
      );
    }
    const nextVersion = input.expectedVersion + 1;
    this.insertVersion({
      documentId: input.documentId,
      version: nextVersion,
      parentVersion: input.expectedVersion,
      content: input.content,
      contentHash: input.contentHash,
      changeSummary: input.changeSummary,
      sourceDescription: input.sourceDescription,
      sourceProvenance: input.sourceProvenance,
    });
    const result = this.database.query(
      `UPDATE managed_documents
       SET current_version = ?, updated_at = ?
       WHERE id = ? AND current_version = ?`,
    ).run(
      nextVersion,
      timestamp(this.context),
      input.documentId,
      input.expectedVersion,
    );
    if (result.changes !== 1) {
      throw new RevisionConflictError(
        "document",
        input.documentId,
        input.expectedVersion,
        this.get(input.documentId)?.currentVersion ?? -1,
      );
    }
    return this.get(input.documentId)!;
  }

  private insertVersion(input: {
    documentId: string;
    version: number;
    parentVersion: number | null;
    content: string;
    contentHash: string;
    changeSummary: string;
    sourceDescription?: string;
    sourceProvenance?: ManagedDocumentSourceProvenance;
  }) {
    this.database.query(
      `INSERT INTO managed_document_versions (
        document_id, version, parent_version, content, content_hash,
        change_id, change_summary, created_at, created_by,
        source_description, source_provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.documentId,
      input.version,
      input.parentVersion,
      input.content,
      input.contentHash,
      this.changeId,
      input.changeSummary,
      timestamp(this.context),
      this.context.actor,
      input.sourceDescription ?? null,
      input.sourceProvenance ? JSON.stringify(input.sourceProvenance) : null,
    );
  }
}

import type { Database } from "bun:sqlite";
import {
  documentReference,
  uploadedDocumentProvenanceSchema,
} from "../../core/src/documents";
import type {
  DocumentOwnerType,
  ManagedDocumentData,
  ManagedDocumentRecord,
  ManagedDocumentVersionData,
} from "../../core/src/documents";
import type {
  ChangeContext,
} from "../../core/src/models";
import type {
  DocumentReadRepository,
  DocumentWriteRepository,
} from "../../core/src/ports";
import { NotFoundError, RevisionConflictError } from "./errors";

type DocumentRow = {
  id: string;
  owner_type: DocumentOwnerType;
  owner_id: string;
  document_type: ManagedDocumentData["documentType"];
  title: string;
  media_type: ManagedDocumentData["mediaType"];
  source_description: string | null;
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
};

const timestamp = (context: ChangeContext) =>
  context.occurredAt ?? new Date().toISOString();

const fromRow = (row: DocumentRow): ManagedDocumentRecord => ({
  id: row.id,
  reference: documentReference(row.id),
  ownerType: row.owner_type,
  ownerId: row.owner_id,
  documentType: row.document_type,
  title: row.title,
  mediaType: row.media_type,
  sourceDescription: row.source_description,
  uploadProvenance: row.upload_provenance_json
    ? uploadedDocumentProvenanceSchema.parse(JSON.parse(row.upload_provenance_json))
    : null,
  currentVersion: row.current_version,
  content: row.content,
  contentHash: row.content_hash,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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
    return row ? fromRow(row) : null;
  }

  list(
    ownerType: DocumentOwnerType,
    ownerId: string,
  ): ManagedDocumentRecord[] {
    const rows = this.database.query(
      `${selectCurrent}
       WHERE d.owner_type = ? AND d.owner_id = ?
       ORDER BY d.document_type, d.title, d.id`,
    ).all(ownerType, ownerId) as DocumentRow[];
    return rows.map(fromRow);
  }

  listVersions(id: string): ManagedDocumentVersionData[] {
    const rows = this.database.query(
      `SELECT * FROM managed_document_versions
       WHERE document_id = ? ORDER BY version DESC`,
    ).all(id) as VersionRow[];
    return rows.map(versionFromRow);
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
  }): ManagedDocumentRecord {
    if (this.get(input.document.id)) {
      throw new Error(`Document already exists: ${input.document.id}`);
    }
    const occurredAt = timestamp(this.context);
    this.database.query(
      `INSERT INTO managed_documents (
        id, owner_type, owner_id, document_type, title, media_type,
        source_description, upload_provenance_json, current_version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      input.document.id,
      input.document.ownerType,
      input.document.ownerId,
      input.document.documentType,
      input.document.title,
      input.document.mediaType,
      input.document.sourceDescription,
      input.document.uploadProvenance
        ? JSON.stringify(input.document.uploadProvenance)
        : null,
      occurredAt,
      occurredAt,
    );
    this.insertVersion({
      documentId: input.document.id,
      version: 1,
      parentVersion: null,
      content: input.content,
      contentHash: input.contentHash,
      changeSummary: this.context.summary,
    });
    return this.get(input.document.id)!;
  }

  addVersion(input: {
    documentId: string;
    expectedVersion: number;
    content: string;
    contentHash: string;
    changeSummary: string;
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
  }) {
    this.database.query(
      `INSERT INTO managed_document_versions (
        document_id, version, parent_version, content, content_hash,
        change_id, change_summary, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  }
}

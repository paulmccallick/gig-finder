import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import {
  candidateProfileId,
  ManagedDocumentService,
  type ManagedDocumentData,
} from "../../core/documents";
import {
  MutationError,
  PersistenceConsistencyError,
} from "../../core/errors";
import type { ChangeContext, GigData, PersonData } from "../../core/models";
import {
  DataStore,
  LocalProfileDocumentFiles,
  migrateDatabase,
  openDatabase,
  RevisionConflictError,
} from "..";

let database: Database;
let store: DataStore;

const timestamp = "2026-07-27T12:00:00.000Z";
const context = (summary: string): ChangeContext => ({
  actor: "test-suite",
  source: "test",
  summary,
  occurredAt: timestamp,
});

const gig: GigData = {
  id: "gig-1",
  company: "Example Company",
  title: "Engineering Director",
  externalJobId: null,
  stage: "identified",
  outcome: "pending",
  statusSummary: "Identified",
  lastActivity: "2026-07-27",
  nextActionDescription: null,
  nextActionDue: null,
  fitRating: "good",
  fitSummary: null,
  payCurrency: null,
  payMinimum: null,
  payMaximum: null,
  payPeriod: null,
  payNotes: null,
  sourceUrl: null,
  location: null,
  workArrangement: null,
  postedDate: null,
  businessUnitTeam: null,
  recruiterSource: null,
  bonus: null,
  equity: null,
  otherCompensation: null,
  tagsJson: "[]",
  hasJobDescription: false,
  hasInterviewPrep: false,
};

const document: ManagedDocumentData = {
  id: "doc_00000000-0000-4000-8000-000000000001",
  links: [{ entityType: "gig", entityId: gig.id }],
  documentType: "job_description",
  title: "Job description",
  description: null,
  mediaType: "text/plain",
  sourceDescription: "Received by text message",
  filePath: null,
  uploadProvenance: null,
};

const person: PersonData = {
  id: "person-1",
  name: "Jordan Example",
  company: "Example Company",
  title: "Director",
  linkedInProfileUrl: null,
  connectedOn: null,
  relationshipType: "professional_contact",
  relationshipStrength: "unknown",
  introducedBy: null,
  relationshipNotes: null,
  priority: "unranked",
  status: "not_contacted",
  whyInteresting: null,
  notesJson: "[]",
  tagsJson: "[]",
};

beforeEach(() => {
  database = openDatabase(":memory:");
  migrateDatabase(database);
  store = new DataStore(database);
  store.change(context("Create records"), transaction => {
    transaction.gigs.create(gig);
    transaction.people.create(person);
  });
});

afterEach(() => database.close());

describe("managed document persistence", () => {
  test("stores profile-owned context and materializes its current Markdown version", async () => {
    const temporaryRoot = path.resolve(import.meta.dir, "../../../tmp");
    await mkdir(temporaryRoot, { recursive: true });
    const directory = await mkdtemp(path.join(temporaryRoot, "profile-documents-"));
    try {
      const materializedStore = new DataStore(
        database,
        new LocalProfileDocumentFiles(directory),
      );
      const documents = new ManagedDocumentService(materializedStore);
      const created = documents.create(context("Create interview stories"), {
        links: [{ entityType: "profile", entityId: candidateProfileId }],
        documentType: "interview_prep",
        title: "Interview stories",
        description: "Behavioral examples from prior leadership roles.",
        mediaType: "text/markdown",
        sourceDescription: null,
        content: "# Interview stories\n\nOriginal examples.",
      });
      const filePath = created.document.filePath!;

      expect(created.document).toMatchObject({
        links: [{ entityType: "profile", entityId: candidateProfileId }],
        title: "Interview stories",
        description: "Behavioral examples from prior leadership roles.",
      });
      expect(filePath).toMatch(/^interview-stories-[0-9a-f]{8}\.md$/);
      expect(documents.profileContext()).toEqual([{
        id: created.document.id,
        name: "Interview stories",
        type: "interview_prep",
        description: "Behavioral examples from prior leadership roles.",
        currentVersion: 1,
      }]);
      expect(await readFile(path.join(directory, filePath), "utf8"))
        .toBe("# Interview stories\n\nOriginal examples.");
      expect(database.query(
        "SELECT profile_id FROM managed_document_links WHERE document_id = ?",
      ).get(created.document.id)).toEqual({ profile_id: candidateProfileId });

      const updated = documents.update(context("Expand interview stories"), {
        documentId: created.document.id,
        expectedVersion: 1,
        content: "# Interview stories\n\nExpanded examples.",
        changeSummary: "Expand examples",
      });
      expect(await readFile(path.join(directory, filePath), "utf8"))
        .toBe("# Interview stories\n\nExpanded examples.");

      await unlink(path.join(directory, filePath));
      materializedStore.synchronizeProfileDocuments();
      expect(await readFile(path.join(directory, filePath), "utf8"))
        .toBe("# Interview stories\n\nExpanded examples.");
      expect(() => new LocalProfileDocumentFiles(directory).write({
        ...updated.document,
        filePath: "../outside.md",
      })).toThrow("unsafe file path");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps failed materialization pending and retries without replaying the change", async () => {
    const temporaryRoot = path.resolve(import.meta.dir, "../../../tmp");
    await mkdir(temporaryRoot, { recursive: true });
    const directory = await mkdtemp(path.join(temporaryRoot, "profile-repair-"));
    const files = new LocalProfileDocumentFiles(directory);
    const failures: Array<{ error: unknown; documentId: string }> = [];
    let failWrites = true;
    let writeCount = 0;
    const materializedStore = new DataStore(database, {
      write: document => {
        writeCount += 1;
        if (failWrites) throw new Error("simulated filesystem failure");
        files.write(document);
      },
    }, (error, failedDocument) => failures.push({
      error,
      documentId: failedDocument.id,
    }));
    const documents = new ManagedDocumentService(materializedStore);

    try {
      const created = documents.create({
        ...context("Create durable context"),
        changeId: "profile-document-change",
      }, {
        links: [{ entityType: "profile", entityId: candidateProfileId }],
        documentType: "notes",
        title: "Search context",
        description: "Durable candidate context.",
        mediaType: "text/markdown",
        sourceDescription: null,
        content: "# Search context",
      });

      expect(created.changeId).toBe("profile-document-change");
      expect(failures).toHaveLength(1);
      expect(database.query(
        "SELECT current_version, materialized_version FROM managed_documents WHERE id = ?",
      ).get(created.document.id)).toEqual({
        current_version: 1,
        materialized_version: null,
      });

      failWrites = false;
      materializedStore.synchronizeProfileDocuments();
      expect(await readFile(path.join(directory, created.document.filePath!), "utf8"))
        .toBe("# Search context");
      expect(database.query(
        "SELECT materialized_version FROM managed_documents WHERE id = ?",
      ).get(created.document.id)).toEqual({ materialized_version: 1 });

      const writesAfterRepair = writeCount;
      materializedStore.change(context("Update unrelated gig"), transaction =>
        transaction.gigs.update(gig.id, 1, { statusSummary: "Reviewed" }));
      expect(writeCount).toBe(writesAfterRepair);
      expect(() => documents.create({
        ...context("Create durable context"),
        changeId: "profile-document-change",
      }, {
        links: [{ entityType: "profile", entityId: candidateProfileId }],
        documentType: "notes",
        title: "Search context",
        description: "Durable candidate context.",
        mediaType: "text/markdown",
        sourceDescription: null,
        content: "# Search context",
      })).toThrow("Change has already been applied");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("validates profile context ownership, name, and description", () => {
    const documents = new ManagedDocumentService(store);
    const base = {
      links: [{ entityType: "profile" as const, entityId: candidateProfileId }],
      documentType: "notes" as const,
      title: "Search principles",
      description: null,
      mediaType: "text/markdown" as const,
      sourceDescription: null,
      content: "# Search principles",
    };
    expect(() => documents.create(context("Missing name"), {
      ...base,
      title: null,
    })).toThrow("requires a name");
    expect(() => documents.create(context("Mixed owners"), {
      ...base,
      links: [...base.links, { entityType: "gig", entityId: gig.id }],
    })).toThrow("must link only to Profile candidate");
    expect(() => documents.create(context("Long description"), {
      ...base,
      description: "x".repeat(256),
    })).toThrow("Too big");
  });

  test("migration preserves legacy gig-owned documents and versions as links", async () => {
    const legacy = openDatabase(":memory:");
    try {
      legacy.exec(`
        CREATE TABLE jobs (id text PRIMARY KEY);
        CREATE TABLE people (id text PRIMARY KEY);
        CREATE TABLE changes (id text PRIMARY KEY);
        CREATE TABLE managed_documents (
          id text PRIMARY KEY, owner_type text NOT NULL, owner_id text NOT NULL,
          document_type text NOT NULL, title text NOT NULL, media_type text NOT NULL,
          source_description text, upload_provenance_json text,
          current_version integer NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
        );
        CREATE TABLE managed_document_versions (
          document_id text NOT NULL, version integer NOT NULL, parent_version integer,
          content text NOT NULL, content_hash text NOT NULL, change_id text NOT NULL,
          change_summary text NOT NULL, created_at text NOT NULL, created_by text NOT NULL,
          PRIMARY KEY(document_id, version),
          FOREIGN KEY(document_id) REFERENCES managed_documents(id),
          FOREIGN KEY(change_id) REFERENCES changes(id)
        );
        INSERT INTO jobs VALUES ('legacy-gig');
        INSERT INTO changes VALUES ('legacy-change');
        INSERT INTO managed_documents VALUES (
          'doc_00000000-0000-4000-8000-000000000099', 'job', 'legacy-gig',
          'notes', 'Legacy notes', 'text/markdown', NULL, NULL, 1,
          '${timestamp}', '${timestamp}'
        );
        INSERT INTO managed_document_versions VALUES (
          'doc_00000000-0000-4000-8000-000000000099', 1, NULL,
          'Legacy content', 'legacy-hash', 'legacy-change', 'Legacy import',
          '${timestamp}', 'test'
        );
      `);
      const migration = await Bun.file(
        new URL("../migrations/0008_shocking_triton.sql", import.meta.url),
      ).text();
      legacy.exec("PRAGMA foreign_keys = OFF");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) legacy.exec(statement);
      }
      legacy.exec("PRAGMA foreign_keys = ON");

      expect(legacy.query(
        "SELECT document_id, job_id, person_id FROM managed_document_links",
      ).get()).toEqual({
        document_id: "doc_00000000-0000-4000-8000-000000000099",
        job_id: "legacy-gig",
        person_id: null,
      });
      expect(legacy.query(
        "SELECT content, content_hash FROM managed_document_versions",
      ).get()).toEqual({ content: "Legacy content", content_hash: "legacy-hash" });
      expect(legacy.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      legacy.close();
    }
  });

  test("indexes one document through gig and person links", () => {
    const linked = store.change(
      context("Create linked profile"),
      transaction => transaction.documents.create({
        document: {
          ...document,
          documentType: "profile",
          title: null,
          links: [
            { entityType: "person", entityId: person.id },
            { entityType: "gig", entityId: gig.id },
          ],
        },
        content: "Profile",
        contentHash: "profile-hash",
      }),
    ).value;

    expect(store.documents.list("person", person.id)).toEqual([linked]);
    expect(store.documents.list("gig", gig.id)).toEqual([linked]);
    expect(linked).toMatchObject({ title: null, displayName: "Profile" });
  });

  test("rejects persisted document links that do not have exactly one target", () => {
    store.change(
      context("Capture job description"),
      transaction => transaction.documents.create({
        document,
        content: "Original job description",
        contentHash: "hash-v1",
      }),
    );
    database.exec("PRAGMA ignore_check_constraints = ON");
    database.query(
      "UPDATE managed_document_links SET gig_id = NULL WHERE document_id = ?",
    ).run(document.id);

    try {
      expect(() => store.documents.get(document.id))
        .toThrow(PersistenceConsistencyError);
      expect(() => store.documents.get(document.id))
        .toThrow(/has 0 targets; expected exactly one/);
    } finally {
      database.exec("PRAGMA ignore_check_constraints = OFF");
    }
  });

  test("creates a document and reads it by id and owner", () => {
    const created = store.change(
      context("Capture job description"),
      transaction => transaction.documents.create({
        document,
        content: "Original job description",
        contentHash: "hash-v1",
      }),
    );

    expect(created.value).toMatchObject({
      ...document,
      displayName: "Job description",
      currentVersion: 1,
      content: "Original job description",
      contentHash: "hash-v1",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(store.documents.get(document.id)).toEqual(created.value);
    expect(store.documents.list("gig", gig.id)).toEqual([created.value]);
    expect(store.documents.list("gig", "another-gig")).toEqual([]);
  });

  test("round-trips uploaded source provenance", () => {
    const uploadProvenance = {
      originalFilename: "role.pdf",
      detectedMediaType: "application/pdf" as const,
      sourceContentHash: "a".repeat(64),
      converter: "pdfjs-dist",
      converterVersion: "6.2.108",
      extractionWarnings: ["Example warning"],
      uploadedAt: timestamp,
    };
    const created = store.change(
      context("Capture uploaded source"),
      transaction => transaction.documents.create({
        document: { ...document, title: null, mediaType: "text/markdown", uploadProvenance },
        content: "Converted Markdown",
        contentHash: "hash-uploaded",
      }),
    );

    expect(created.value.uploadProvenance).toEqual(uploadProvenance);
    expect(created.value.displayName).toBe("role.pdf");
    expect(store.documents.get(document.id)?.uploadProvenance).toEqual(uploadProvenance);
  });

  test("adds immutable versions while preserving earlier content", () => {
    const created = store.change(
      context("Capture job description"),
      transaction => transaction.documents.create({
        document,
        content: "Version one",
        contentHash: "hash-v1",
      }),
    );
    const updatedAt = "2026-07-28T12:00:00.000Z";
    const updated = store.change(
      { ...context("Correct transcription"), occurredAt: updatedAt },
      transaction => transaction.documents.addVersion({
        documentId: document.id,
        expectedVersion: 1,
        content: "Version two",
        contentHash: "hash-v2",
        changeSummary: "Correct transcription",
      }),
    );

    expect(updated.value).toMatchObject({
      currentVersion: 2,
      content: "Version two",
      contentHash: "hash-v2",
      createdAt: timestamp,
      updatedAt,
    });
    expect(store.documents.listVersions(document.id)).toEqual([
      {
        documentId: document.id,
        version: 2,
        parentVersion: 1,
        content: "Version two",
        contentHash: "hash-v2",
        changeId: updated.changeId,
        changeSummary: "Correct transcription",
        createdAt: updatedAt,
        createdBy: "test-suite",
      },
      {
        documentId: document.id,
        version: 1,
        parentVersion: null,
        content: "Version one",
        contentHash: "hash-v1",
        changeId: created.changeId,
        changeSummary: "Capture job description",
        createdAt: timestamp,
        createdBy: "test-suite",
      },
    ]);
  });

  test("rolls back document metadata and versions atomically", () => {
    expect(() => store.change(
      context("Failed capture"),
      transaction => {
        transaction.documents.create({
          document,
          content: "Do not persist",
          contentHash: "hash-failed",
        });
        throw new Error("stop");
      },
    )).toThrow("stop");

    expect(store.documents.get(document.id)).toBeNull();
    expect(database.query(
      "SELECT count(*) AS count FROM managed_documents",
    ).get()).toEqual({ count: 0 });
    expect(database.query(
      "SELECT count(*) AS count FROM managed_document_versions",
    ).get()).toEqual({ count: 0 });
    expect(database.query(
      "SELECT count(*) AS count FROM changes",
    ).get()).toEqual({ count: 1 });
  });

  test("rejects a stale expected version without adding a change or version", () => {
    store.change(
      context("Capture job description"),
      transaction => transaction.documents.create({
        document,
        content: "Version one",
        contentHash: "hash-v1",
      }),
    );
    store.change(
      context("First update"),
      transaction => transaction.documents.addVersion({
        documentId: document.id,
        expectedVersion: 1,
        content: "Version two",
        contentHash: "hash-v2",
        changeSummary: "First update",
      }),
    );

    expect(() => store.change(
      context("Stale update"),
      transaction => transaction.documents.addVersion({
        documentId: document.id,
        expectedVersion: 1,
        content: "Stale version",
        contentHash: "hash-stale",
        changeSummary: "Stale update",
      }),
    )).toThrow(RevisionConflictError);

    expect(store.documents.get(document.id)).toMatchObject({
      currentVersion: 2,
      content: "Version two",
    });
    expect(store.documents.listVersions(document.id)).toHaveLength(2);
    expect(database.query(
      "SELECT count(*) AS count FROM changes",
    ).get()).toEqual({ count: 3 });
  });

  test("uses explicit change IDs to make create and update retries idempotent", () => {
    const documents = new ManagedDocumentService(store);
    const created = documents.create(
      { ...context("Create managed document"), changeId: "document-create" },
      {
        links: [{ entityType: "gig", entityId: gig.id }],
        documentType: "notes",
        title: "Role notes",
        mediaType: "text/markdown",
        sourceDescription: null,
        content: "Version one",
      },
    );

    expect(() => documents.create(
      { ...context("Create managed document"), changeId: "document-create" },
      {
        links: [{ entityType: "gig", entityId: gig.id }],
        documentType: "notes",
        title: "Role notes",
        mediaType: "text/markdown",
        sourceDescription: null,
        content: "Version one",
      },
    )).toThrow(new MutationError(
      "duplicate_change",
      "Change has already been applied: document-create",
    ));

    documents.update(
      { ...context("Update managed document"), changeId: "document-update" },
      {
        documentId: created.document.id,
        expectedVersion: 1,
        content: "Version two",
        changeSummary: "Revise notes",
      },
    );
    expect(() => documents.update(
      { ...context("Update managed document"), changeId: "document-update" },
      {
        documentId: created.document.id,
        expectedVersion: 1,
        content: "Version two",
        changeSummary: "Revise notes",
      },
    )).toThrow(new MutationError(
      "duplicate_change",
      "Change has already been applied: document-update",
    ));

    expect(documents.list("gig", gig.id)).toHaveLength(1);
    expect(documents.versions(created.document.id)).toHaveLength(2);
  });
});

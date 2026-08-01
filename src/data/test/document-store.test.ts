import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  ManagedDocumentService,
  type ManagedDocumentData,
} from "../../core/src/documents";
import { MutationError } from "../../core/src/errors";
import type { ChangeContext, GigData, PersonData } from "../../core/src/models";
import {
  DataStore,
  migrateDatabase,
  openDatabase,
  RevisionConflictError,
} from "../src";

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
  mediaType: "text/plain",
  sourceDescription: "Received by text message",
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
  lastContacted: null,
  lastContactMethod: null,
  lastContactSummary: null,
  nextAction: null,
  nextActionDue: null,
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
        new URL("../drizzle/0008_shocking_triton.sql", import.meta.url),
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

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  ManagedDocumentService,
  type ManagedDocumentData,
} from "../../core/src/documents";
import { MutationError } from "../../core/src/errors";
import type { ChangeContext, JobData } from "../../core/src/models";
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

const job: JobData = {
  id: "job-1",
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
  ownerType: "job",
  ownerId: job.id,
  documentType: "job_description",
  title: "Job description",
  mediaType: "text/plain",
  sourceDescription: "Received by text message",
};

beforeEach(() => {
  database = openDatabase(":memory:");
  migrateDatabase(database);
  store = new DataStore(database);
  store.change(context("Create job"), transaction => transaction.jobs.create(job));
});

afterEach(() => database.close());

describe("managed document persistence", () => {
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
      reference: `document:${document.id}`,
      currentVersion: 1,
      content: "Original job description",
      contentHash: "hash-v1",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(store.documents.get(document.id)).toEqual(created.value);
    expect(store.documents.list("job", job.id)).toEqual([created.value]);
    expect(store.documents.list("job", "another-job")).toEqual([]);
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
        ownerType: "job",
        ownerId: job.id,
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
        ownerType: "job",
        ownerId: job.id,
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
        reference: created.document.reference,
        expectedVersion: 1,
        content: "Version two",
        changeSummary: "Revise notes",
      },
    );
    expect(() => documents.update(
      { ...context("Update managed document"), changeId: "document-update" },
      {
        reference: created.document.reference,
        expectedVersion: 1,
        content: "Version two",
        changeSummary: "Revise notes",
      },
    )).toThrow(new MutationError(
      "duplicate_change",
      "Change has already been applied: document-update",
    ));

    expect(documents.list("job", job.id)).toHaveLength(1);
    expect(documents.versions(created.document.reference)).toHaveLength(2);
  });
});

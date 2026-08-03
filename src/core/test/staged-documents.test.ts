import { describe, expect, test } from "bun:test";
import {
  StagedDocumentCapacityError,
  StagedDocumentService,
} from "../src/staged-documents";

const provenance = {
  originalFilename: "role.md",
  detectedMediaType: "text/markdown" as const,
  sourceContentHash: "a".repeat(64),
  converter: "utf-8",
  converterVersion: "1",
  extractionWarnings: [],
  uploadedAt: "2026-07-29T12:00:00.000Z",
};

describe("staged documents", () => {
  test("reads and discards staged Markdown by opaque reference", () => {
    const service = new StagedDocumentService();
    const staged = service.stage({ markdown: "# Role", provenance });

    expect(staged.reference).toMatch(/^staged-document:/);
    expect(service.get(staged.reference)).toEqual(staged);
    const consumption = {
      changed: true,
      changeId: "change-1",
      document: {
        id: "doc_11111111-1111-4111-8111-111111111111",
        links: [{ entityType: "gig" as const, entityId: "gig-1" }],
        documentType: "job_description" as const,
        title: "Role",
        description: null,
        displayName: "Role",
        mediaType: "text/markdown" as const,
        sourceDescription: null,
        filePath: null,
        uploadProvenance: provenance,
        currentVersion: 1,
        contentHash: "content-hash",
        createdAt: provenance.uploadedAt,
        updatedAt: provenance.uploadedAt,
      },
    };
    expect(service.consume(staged.reference, consumption)).toEqual(consumption);
    expect(service.consume(staged.reference, {
      ...consumption,
      changeId: "different-change",
    })).toEqual(consumption);
    expect(service.discard(staged.reference)).toBe(true);
    expect(service.get(staged.reference)).toBeNull();
  });

  test("removes expired documents", () => {
    let now = new Date("2026-07-29T12:00:00.000Z");
    const service = new StagedDocumentService({
      lifetimeMs: 1_000,
      now: () => now,
    });
    const staged = service.stage({ markdown: "# Role", provenance });

    now = new Date("2026-07-29T12:00:01.000Z");
    expect(service.get(staged.reference)).toBeNull();
  });

  test("rejects staging beyond entry and aggregate character capacity", () => {
    const entryLimited = new StagedDocumentService({
      maxDocuments: 1,
      maxTotalCharacters: 100,
    });
    entryLimited.stage({ markdown: "# One", provenance });
    expect(() => entryLimited.stage({ markdown: "# Two", provenance }))
      .toThrow(StagedDocumentCapacityError);

    const characterLimited = new StagedDocumentService({
      maxDocuments: 2,
      maxTotalCharacters: 10,
    });
    characterLimited.stage({ markdown: "123456", provenance });
    expect(() => characterLimited.stage({ markdown: "12345", provenance }))
      .toThrow(StagedDocumentCapacityError);
  });

  test("rejects provenance that managed documents cannot persist", () => {
    const service = new StagedDocumentService();
    expect(() => service.stage({
      markdown: "# Role",
      provenance: {
        ...provenance,
        extractionWarnings: ["x".repeat(501)],
      },
    })).toThrow("Uploaded document provenance is invalid.");
  });
});

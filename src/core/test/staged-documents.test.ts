import { describe, expect, test } from "bun:test";
import { StagedDocumentService } from "../src/staged-documents";

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
    expect(service.discard(staged.reference)).toBe(true);
    expect(service.get(staged.reference)).toBeNull();
  });

  test("removes expired documents", () => {
    let now = new Date("2026-07-29T12:00:00.000Z");
    const service = new StagedDocumentService(1_000, () => now);
    const staged = service.stage({ markdown: "# Role", provenance });

    now = new Date("2026-07-29T12:00:01.000Z");
    expect(service.get(staged.reference)).toBeNull();
  });
});

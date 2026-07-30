import { describe, expect, test } from "bun:test";
import { StagedDocumentService } from "../core/src";
import type { DocumentConverter } from "./document-conversion";
import { createDocumentUploadHandler } from "./document-upload-handler";

const converted = {
  markdown: "# Director Role",
  provenance: {
    originalFilename: "role.md",
    detectedMediaType: "text/markdown" as const,
    sourceContentHash: "a".repeat(64),
    converter: "utf-8",
    converterVersion: "1",
    extractionWarnings: [],
    uploadedAt: "2026-07-29T12:00:00.000Z",
  },
};

describe("document upload handler", () => {
  test("stages converted Markdown without returning document content", async () => {
    const service = new StagedDocumentService();
    const converter: DocumentConverter = { convert: async () => converted };
    const handler = createDocumentUploadHandler(converter, service, 1_000);
    const form = new FormData();
    form.set("file", new File(["# Director Role"], "role.md", { type: "text/markdown" }));

    const response = await handler(new Request("http://localhost/api/agent/documents", {
      method: "POST",
      body: form,
    }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ filename: "role.md", markdownCharacters: 15 });
    expect(body).not.toHaveProperty("markdown");
    expect(service.get(String(body.reference))?.markdown).toBe("# Director Role");
  });

  test("returns a capacity response when staging memory is full", async () => {
    const service = new StagedDocumentService({
      maxDocuments: 1,
      maxTotalCharacters: 100,
    });
    service.stage(converted);
    const converter: DocumentConverter = { convert: async () => converted };
    const handler = createDocumentUploadHandler(converter, service, 1_000);
    const form = new FormData();
    form.set("file", new File(["# Another Role"], "another.md", {
      type: "text/markdown",
    }));

    await expect(handler(new Request("http://localhost/api/agent/documents", {
      method: "POST",
      body: form,
    }))).rejects.toMatchObject({ status: 429 });
  });
});

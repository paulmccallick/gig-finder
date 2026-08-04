import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  LocalDocumentConverter,
} from "../document-conversion";

const converter = new LocalDocumentConverter({
  maxBytes: 1_000_000,
  maxCharacters: 50_000,
  maxPdfPages: 10,
  maxDocxUncompressedBytes: 1_000_000,
});
const uploadedAt = "2026-07-29T12:00:00.000Z";

async function docxFixture(extraUncompressedBytes = 0) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Director Role</w:t></w:r></w:p>
      <w:p><w:r><w:t>Lead the platform organization.</w:t></w:r></w:p></w:body>
    </w:document>`);
  if (extraUncompressedBytes > 0) {
    zip.file("word/large-entry.bin", "x".repeat(extraUncompressedBytes));
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

async function pdfFixture(withText = true) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  if (withText) {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Director Role - lead the platform organization.", { font });
  }
  return new Uint8Array(await pdf.save());
}

describe("local document conversion", () => {
  test("preserves Markdown text and records source provenance", async () => {
    const bytes = new TextEncoder().encode("# Director Role\n\nExact source text.\n");
    const result = await converter.convert({
      filename: "role.md",
      declaredMediaType: "text/markdown",
      bytes,
      uploadedAt,
    });

    expect(result.markdown).toBe("# Director Role\n\nExact source text.");
    expect(result.provenance).toMatchObject({
      originalFilename: "role.md",
      detectedMediaType: "text/markdown",
      converter: "utf-8",
      uploadedAt,
    });
    expect(result.provenance.sourceContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("converts DOCX structure to Markdown", async () => {
    const result = await converter.convert({
      filename: "role.docx",
      declaredMediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await docxFixture(),
      uploadedAt,
    });

    expect(result.markdown).toContain("# Director Role");
    expect(result.markdown).toContain("Lead the platform organization.");
    expect(result.provenance.converter).toBe("mammoth+turndown");
  });

  test("rejects highly compressed DOCX content before extraction", async () => {
    const limitedConverter = new LocalDocumentConverter({
      maxBytes: 1_000_000,
      maxCharacters: 50_000,
      maxPdfPages: 10,
      maxDocxUncompressedBytes: 10_000,
    });
    await expect(limitedConverter.convert({
      filename: "large.docx",
      declaredMediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await docxFixture(100_000),
      uploadedAt,
    })).rejects.toMatchObject({
      code: "extraction_too_large",
    });
  });

  test("extracts PDF text and rejects image-only PDFs", async () => {
    const result = await converter.convert({
      filename: "role.pdf",
      declaredMediaType: "application/pdf",
      bytes: await pdfFixture(),
      uploadedAt,
    });
    expect(result.markdown).toContain("Director Role");

    await expect(converter.convert({
      filename: "scan.pdf",
      declaredMediaType: "application/pdf",
      bytes: await pdfFixture(false),
      uploadedAt,
    })).rejects.toMatchObject({ code: "image_only_pdf" });
  });

  test("rejects unsupported types, mismatched signatures, and configured limits", async () => {
    await expect(converter.convert({
      filename: "role.txt",
      declaredMediaType: "text/plain",
      bytes: new TextEncoder().encode("Role"),
      uploadedAt,
    })).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(converter.convert({
      filename: "role.pdf",
      declaredMediaType: "application/pdf",
      bytes: new TextEncoder().encode("not a pdf"),
      uploadedAt,
    })).rejects.toMatchObject({ code: "malformed_document" });
    const tinyConverter = new LocalDocumentConverter({
      maxBytes: 2,
      maxCharacters: 50_000,
      maxPdfPages: 10,
      maxDocxUncompressedBytes: 1_000_000,
    });
    await expect(tinyConverter.convert({
      filename: "role.md",
      declaredMediaType: "text/markdown",
      bytes: new TextEncoder().encode("too long"),
      uploadedAt,
    })).rejects.toMatchObject({ code: "upload_too_large" });
  });

  test("rejects provenance metadata that cannot be persisted", async () => {
    await expect(converter.convert({
      filename: "role.md",
      declaredMediaType: "text/markdown",
      bytes: new TextEncoder().encode("# Role"),
      uploadedAt: "not-a-timestamp",
    })).rejects.toMatchObject({
      code: "malformed_document",
    });
  });
});

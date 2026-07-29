import { createHash } from "node:crypto";
import path from "node:path";
import mammoth from "mammoth";
import TurndownService from "turndown";
import {
  getDocument,
  version as pdfJsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  UploadedDocumentProvenance,
  UploadedSourceMediaType,
} from "../core/src";

export interface ConvertedUpload {
  markdown: string;
  provenance: UploadedDocumentProvenance;
}

export interface DocumentConversionLimits {
  maxBytes: number;
  maxCharacters: number;
  maxPdfPages: number;
}

export class DocumentConversionError extends Error {
  constructor(
    readonly code:
      | "empty_extraction"
      | "encrypted_pdf"
      | "image_only_pdf"
      | "malformed_document"
      | "unsupported_file"
      | "upload_too_large"
      | "extraction_too_large",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface DocumentConverter {
  convert(input: {
    filename: string;
    declaredMediaType: string;
    bytes: Uint8Array;
    uploadedAt: string;
  }): Promise<ConvertedUpload>;
}

const docxMediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const acceptedDeclaredTypes: Record<UploadedSourceMediaType, readonly string[]> = {
  "application/pdf": ["application/pdf", "application/octet-stream", ""],
  [docxMediaType]: [docxMediaType, "application/zip", "application/octet-stream", ""],
  "text/markdown": ["text/markdown", "text/plain", "application/octet-stream", ""],
};

const extensionMediaTypes: Record<string, UploadedSourceMediaType | undefined> = {
  ".pdf": "application/pdf",
  ".docx": docxMediaType,
  ".md": "text/markdown",
};

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const tidyMarkdown = (value: string) => value
  .replace(/\r\n?/g, "\n")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{4,}/g, "\n\n\n")
  .trim();

function validateDetectedType(
  filename: string,
  declaredMediaType: string,
  bytes: Uint8Array,
): UploadedSourceMediaType {
  const extension = path.extname(path.basename(filename)).toLocaleLowerCase();
  const mediaType = extensionMediaTypes[extension];
  if (!mediaType) {
    throw new DocumentConversionError(
      "unsupported_file",
      "Upload a DOCX, Markdown, or PDF file.",
    );
  }
  if (!acceptedDeclaredTypes[mediaType].includes(declaredMediaType.toLocaleLowerCase())) {
    throw new DocumentConversionError(
      "unsupported_file",
      `The declared file type does not match ${extension}.`,
    );
  }
  if (mediaType === "application/pdf") {
    const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") {
      throw new DocumentConversionError("malformed_document", "The PDF signature is invalid.");
    }
  }
  if (mediaType === docxMediaType) {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new DocumentConversionError("malformed_document", "The DOCX container is invalid.");
    }
  }
  if (mediaType === "text/markdown" && bytes.includes(0)) {
    throw new DocumentConversionError(
      "malformed_document",
      "The Markdown upload contains binary data.",
    );
  }
  return mediaType;
}

async function markdownFromDocx(bytes: Uint8Array) {
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      { includeDefaultStyleMap: true },
    );
    const warnings = result.messages.map(message => `${message.type}: ${message.message}`);
    const turndown = new TurndownService({
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      headingStyle: "atx",
    });
    if (/<img\b/i.test(result.value)) {
      warnings.push("Embedded images were omitted from Markdown extraction.");
      turndown.addRule("omit-images", { filter: "img", replacement: () => "" });
    }
    return {
      markdown: tidyMarkdown(turndown.turndown(result.value)),
      converter: "mammoth+turndown",
      converterVersion: "mammoth@1.12.0;turndown@7.2.4",
      warnings,
    };
  } catch (error) {
    throw new DocumentConversionError(
      "malformed_document",
      "The DOCX file could not be read.",
      { cause: error },
    );
  }
}

async function markdownFromPdf(bytes: Uint8Array, maxPages: number) {
  try {
    const pdf = await getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
    }).promise;
    if (pdf.numPages > maxPages) {
      throw new DocumentConversionError(
        "extraction_too_large",
        `PDF files are limited to ${maxPages} pages.`,
      );
    }
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      pages.push(tidyMarkdown(text));
    }
    const markdown = pages.filter(Boolean).join("\n\n---\n\n");
    if (!markdown) {
      throw new DocumentConversionError(
        "image_only_pdf",
        "The PDF contains no extractable text. OCR is not supported.",
      );
    }
    return {
      markdown,
      converter: "pdfjs-dist",
      converterVersion: pdfJsVersion,
      warnings: [] as string[],
    };
  } catch (error) {
    if (error instanceof DocumentConversionError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      throw new DocumentConversionError(
        "encrypted_pdf",
        "Encrypted or password-protected PDFs are not supported.",
        { cause: error },
      );
    }
    throw new DocumentConversionError(
      "malformed_document",
      "The PDF file could not be read.",
      { cause: error },
    );
  }
}

export class LocalDocumentConverter implements DocumentConverter {
  constructor(private readonly limits: DocumentConversionLimits) {}

  async convert(input: {
    filename: string;
    declaredMediaType: string;
    bytes: Uint8Array;
    uploadedAt: string;
  }): Promise<ConvertedUpload> {
    if (input.bytes.byteLength > this.limits.maxBytes) {
      throw new DocumentConversionError(
        "upload_too_large",
        `Uploads are limited to ${this.limits.maxBytes} bytes.`,
      );
    }
    const detectedMediaType = validateDetectedType(
      input.filename,
      input.declaredMediaType,
      input.bytes,
    );
    let converted: {
      markdown: string;
      converter: string;
      converterVersion: string;
      warnings: string[];
    };
    if (detectedMediaType === "text/markdown") {
      try {
        converted = {
          markdown: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
          converter: "utf-8",
          converterVersion: "1",
          warnings: [],
        };
      } catch (error) {
        throw new DocumentConversionError(
          "malformed_document",
          "The Markdown file is not valid UTF-8.",
          { cause: error },
        );
      }
    } else if (detectedMediaType === docxMediaType) {
      converted = await markdownFromDocx(input.bytes);
    } else {
      converted = await markdownFromPdf(input.bytes, this.limits.maxPdfPages);
    }
    converted.markdown = tidyMarkdown(converted.markdown);
    if (!converted.markdown) {
      throw new DocumentConversionError(
        "empty_extraction",
        "The uploaded document contains no extractable text.",
      );
    }
    if (converted.markdown.length > this.limits.maxCharacters) {
      throw new DocumentConversionError(
        "extraction_too_large",
        `Extracted content is limited to ${this.limits.maxCharacters} characters.`,
      );
    }
    return {
      markdown: converted.markdown,
      provenance: {
        originalFilename: path.basename(input.filename),
        detectedMediaType,
        sourceContentHash: hash(input.bytes),
        converter: converted.converter,
        converterVersion: converted.converterVersion,
        extractionWarnings: converted.warnings.slice(0, 20),
        uploadedAt: input.uploadedAt,
      },
    };
  }
}

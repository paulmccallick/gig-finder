import {
  StagedDocumentCapacityError,
  type StagedDocumentService,
} from "../core";
import {
  DocumentConversionError,
  type DocumentConverter,
} from "./document-conversion";
import { WebRequestError } from "./agent-handler";

const errorStatus = (error: DocumentConversionError) => {
  if (error.code === "upload_too_large" || error.code === "extraction_too_large") return 413;
  if (error.code === "unsupported_file") return 415;
  return 422;
};

export function createDocumentUploadHandler(
  converter: DocumentConverter,
  stagedDocuments: StagedDocumentService,
  maxUploadBytes: number,
) {
  return async (request: Request) => {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxUploadBytes + 1_000_000) {
      throw new WebRequestError(`Uploads are limited to ${maxUploadBytes} bytes.`, 413);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      throw new WebRequestError("Upload must be valid multipart form data.", 400, {
        cause: error,
      });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new WebRequestError("A document file is required.", 400);
    }
    try {
      const converted = await converter.convert({
        filename: file.name,
        declaredMediaType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        uploadedAt: new Date().toISOString(),
      });
      if (request.signal.aborted) {
        throw new WebRequestError("The upload was cancelled.", 400);
      }
      const staged = stagedDocuments.stage(converted);
      return Response.json({
        reference: staged.reference,
        filename: staged.provenance.originalFilename,
        detectedMediaType: staged.provenance.detectedMediaType,
        contentHash: staged.provenance.sourceContentHash,
        converter: staged.provenance.converter,
        converterVersion: staged.provenance.converterVersion,
        extractionWarnings: staged.provenance.extractionWarnings,
        uploadedAt: staged.provenance.uploadedAt,
        markdownCharacters: staged.markdown.length,
        expiresAt: staged.expiresAt,
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof DocumentConversionError) {
        throw new WebRequestError(error.message, errorStatus(error), { cause: error });
      }
      if (error instanceof StagedDocumentCapacityError) {
        throw new WebRequestError(error.message, 429, { cause: error });
      }
      throw error;
    }
  };
}

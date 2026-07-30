import path from "node:path";
import { createAgentHandler } from "../web/agent-handler";
import { createWebHandler } from "../web/server";
import {
  activeLogFile,
  configuredLogLevel,
  logger,
  requestLogger,
} from "../observability/logger";
import { loadJobSearchProfile } from "../agent/profile-loader";
import { openLocalApplication, resolveJobSearchContext } from "../sqlite/src";
import { registerDevelopmentTelemetry } from "../observability/devtools";
import { managedDocumentContentLimit, StagedDocumentService } from "../core/src";
import { LocalDocumentConverter } from "../web/document-conversion";
import { createDocumentUploadHandler } from "../web/document-upload-handler";

const repoRoot = path.resolve(import.meta.dir, "../..");
const devToolsEnabled = await registerDevelopmentTelemetry();
const context = resolveJobSearchContext(repoRoot);
const local = openLocalApplication({
  database: context.database,
  artifacts: context.artifacts,
});
const jobSearch = local.application;
const port = Number(process.env.API_PORT ?? 3001);
const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const uploadLimits = {
  maxBytes: positiveInteger(process.env.DOCUMENT_UPLOAD_MAX_BYTES, 10_000_000),
  maxCharacters: positiveInteger(process.env.DOCUMENT_EXTRACTION_MAX_CHARACTERS, managedDocumentContentLimit),
  maxPdfPages: positiveInteger(process.env.DOCUMENT_PDF_MAX_PAGES, 100),
  maxDocxUncompressedBytes: positiveInteger(process.env.DOCUMENT_DOCX_MAX_UNCOMPRESSED_BYTES, 25_000_000),
};
const stagedDocuments = new StagedDocumentService({
  lifetimeMs: positiveInteger(process.env.DOCUMENT_STAGE_TTL_MS, 15 * 60 * 1000),
  maxDocuments: positiveInteger(process.env.DOCUMENT_STAGE_MAX_DOCUMENTS, 20),
  maxTotalCharacters: positiveInteger(process.env.DOCUMENT_STAGE_MAX_CHARACTERS, managedDocumentContentLimit * 10),
});
const uploadHandler = createDocumentUploadHandler(
  new LocalDocumentConverter(uploadLimits),
  stagedDocuments,
  uploadLimits.maxBytes,
);
const agentHandler = createAgentHandler(
  loadJobSearchProfile(context.profile),
  undefined,
  logger,
  jobSearch.agentContext,
  jobSearch,
  context.actor,
  { contextSearch: jobSearch.contextSearch, stagedDocuments },
);
const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  maxRequestBodySize: uploadLimits.maxBytes + 1_000_000,
  fetch: createWebHandler({
    jobSearch,
    agentHandler,
    uploadHandler,
    discardStagedDocument: reference => stagedDocuments.discard(reference),
    requestLogger,
  }),
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop(true);
  local.close();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

logger.info({
  event: "server.started",
  address: `http://127.0.0.1:${port}`,
  logFile: activeLogFile,
  logLevel: configuredLogLevel,
  aiSdkDevTools: devToolsEnabled,
}, "Read-only jobs API listening");

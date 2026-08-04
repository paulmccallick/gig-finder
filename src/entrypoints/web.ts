import path from "node:path";
import { createAgentHandler } from "../web/agent-handler";
import { createWebHandler } from "../web/server";
import {
  activeLogFile,
  configuredLogLevel,
  logger,
  requestLogger,
} from "../observability/logger";
import { loadCandidateProfile } from "../agent/profile-loader";
import { openLocalApplication, resolveGigFinderContext } from "../data/src";
import { registerDevelopmentTelemetry } from "../observability/devtools";
import { managedDocumentContentLimit, StagedDocumentService } from "../core/src";
import {
  defaultAgentModelId,
  parseAgentModelId,
} from "../core/src/application-settings";
import { LocalDocumentConverter } from "../web/document-conversion";
import { createDocumentUploadHandler } from "../web/document-upload-handler";
import { createStaticFileHandler } from "../web/static-files";
import { resolveGigFinderRuntime } from "./runtime";

const repoRoot = path.resolve(import.meta.dir, "../..");
const runtime = resolveGigFinderRuntime(repoRoot);
const devToolsEnabled = await registerDevelopmentTelemetry();
const context = resolveGigFinderContext(repoRoot);
const defaultAgentModel = parseAgentModelId(
  process.env.CODEX_AGENT_MODEL ?? defaultAgentModelId,
);
const local = openLocalApplication({
  database: context.database,
  artifacts: context.artifacts,
  profileDocuments: context.profileDocuments,
}, {
  defaultAgentModel,
  onProfileDocumentMaterializationFailure: (error, document) => logger.error({
    event: "profile_document.materialization_failed",
    documentId: document.id,
    documentVersion: document.currentVersion,
    err: error,
  }, "Profile document materialization remains pending"),
});
const gigFinder = local.application;
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
const agentHandler = createAgentHandler({
  profile: loadCandidateProfile(context.profile),
  profileDocuments: () => gigFinder.documents.profileContext(),
  logger,
  reads: {
    gigs: gigFinder.gigs,
    people: gigFinder.people,
    gigPeople: gigFinder.gigPeople,
    tasks: gigFinder.tasks,
    meetings: gigFinder.meetings,
    documents: gigFinder.documentReader,
  },
  mutations: gigFinder,
  actor: context.actor,
  toolExtensions: { contextSearch: gigFinder.contextSearch, stagedDocuments },
  selectModel: () => gigFinder.settings.get().agentModel,
});
const server = Bun.serve({
  port: runtime.port,
  hostname: runtime.hostname,
  maxRequestBodySize: uploadLimits.maxBytes + 1_000_000,
  fetch: createWebHandler({
    gigFinder,
    agentHandler,
    uploadHandler,
    discardStagedDocument: reference => stagedDocuments.discard(reference),
    requestLogger,
    healthCheck: () => {
      const validation = local.validate();
      return {
        ok: validation.ok,
        revision: runtime.revision,
        integrity: validation.integrity,
        foreignKeyViolations: validation.foreignKeyViolations,
      };
    },
    staticFiles: runtime.staticRoot
      ? createStaticFileHandler(runtime.staticRoot)
      : undefined,
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
  address: `http://${runtime.hostname}:${runtime.port}`,
  runtime: runtime.mode,
  revision: runtime.revision,
  logFile: activeLogFile,
  logLevel: configuredLogLevel,
  aiSdkDevTools: devToolsEnabled,
}, "Read-only gigs API listening");

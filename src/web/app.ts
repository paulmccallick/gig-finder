import path from "node:path";
import { createHash } from "node:crypto";
import { loadCandidateProfile } from "../agent/profile-loader";
import {
  defaultAgentModelId,
  parseAgentModelId,
  type AgentModelId,
} from "../core/application-settings";
import { managedDocumentContentLimit } from "../core/documents";
import { StagedDocumentService } from "../core/staged-documents";
import {
  openLocalApplication,
  resolveGigFinderContext,
  type GigFinderContextPaths,
} from "../data";
import { registerAiSdkDevTools } from "../observability/devtools";
import { createApplicationLogger } from "../observability/logger";
import { createAgentApi } from "./agent-handler";
import { ConversationService } from "../core/conversation-service";
import { GigFinderConversationRuntime } from "../agent/ai-sdk-conversation-runtime";
import { createCodexLanguageModel } from "../agent/codex-provider";
import { LocalDocumentConverter } from "./document-conversion";
import { createDocumentUploadHandler } from "./document-upload-handler";
import { createWebHandler } from "./request-handler";
import { createStaticFileHandler } from "./static-files";
import { ScoutRuntime } from "../operations/scout-runtime";
import {ScoutPositionRuntime} from "../operations/scout-position-runtime";
import { importScoutCompany } from "../core/scout/engine/company-import";
import { scoutTemplateCatalog } from "../operations/scout-template-catalog";
import { AiSdkScoutScreeningModel } from "../agent/scout-position-screening";
import { ScoutPositionProcessor } from "../core/scout/engine/screening";

type ProcessEnvironment = Record<string, string | undefined>;

export interface WebConfiguration {
  server: {
    hostname: string;
    port: number;
    staticRoot: string | null;
    revision: string;
  };
  context: GigFinderContextPaths;
  defaultAgentModel: AgentModelId;
  logLevel: string;
  aiSdkDevTools: boolean;
  smoke: {
    mode: "deterministic" | "live" | null;
    providerBaseURL: string | null;
    maxSteps: number | undefined;
    maxOutputTokens: number | undefined;
  };
  uploads: {
    maxBytes: number;
    maxCharacters: number;
    maxPdfPages: number;
    maxDocxUncompressedBytes: number;
  };
  staging: {
    lifetimeMs: number;
    maxDocuments: number;
    maxTotalCharacters: number;
  };
  scout: { batchSize:number; concurrency:number };
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function port(value: string | undefined) {
  const parsed = positiveInteger(value, 3000, "PORT");
  if (parsed > 65_535) throw new Error("PORT must not exceed 65535.");
  return parsed;
}

export function loadWebConfiguration(
  applicationRoot: string,
  environment: ProcessEnvironment = process.env,
): WebConfiguration {
  const staticRoot = environment.STATIC_ROOT?.trim();
  const smokeModeValue = environment.GIG_FINDER_SMOKE_MODE?.trim();
  if (smokeModeValue && smokeModeValue !== "deterministic" && smokeModeValue !== "live") {
    throw new Error("GIG_FINDER_SMOKE_MODE must be deterministic or live.");
  }
  const smokeMode = smokeModeValue as "deterministic" | "live" | undefined;
  const providerBaseURL = environment.GIG_FINDER_SMOKE_PROVIDER_URL?.trim();
  if (providerBaseURL && smokeMode !== "deterministic") {
    throw new Error("The smoke provider endpoint is allowed only in deterministic smoke mode.");
  }
  if (smokeMode === "deterministic" && !providerBaseURL) {
    throw new Error("Deterministic smoke mode requires GIG_FINDER_SMOKE_PROVIDER_URL.");
  }
  if (providerBaseURL) {
    const endpoint = new URL(providerBaseURL);
    if (endpoint.protocol !== "http:") {
      throw new Error("The deterministic smoke provider endpoint must use HTTP.");
    }
  }
  return {
    server: {
      hostname: environment.HOST?.trim() || "127.0.0.1",
      port: port(environment.PORT),
      staticRoot: staticRoot ? path.resolve(applicationRoot, staticRoot) : null,
      revision: environment.APP_REVISION?.trim() || "unversioned",
    },
    context: resolveGigFinderContext(applicationRoot, environment),
    defaultAgentModel: parseAgentModelId(
      environment.CODEX_AGENT_MODEL ?? defaultAgentModelId,
    ),
    logLevel: environment.LOG_LEVEL?.trim() || "debug",
    aiSdkDevTools: environment.AI_SDK_DEVTOOLS === "true",
    smoke: {
      mode: smokeMode ?? null,
      providerBaseURL: providerBaseURL ?? null,
      maxSteps: smokeMode ? 2 : undefined,
      maxOutputTokens: smokeMode === "deterministic" ? 128 : undefined,
    },
    uploads: {
      maxBytes: positiveInteger(
        environment.DOCUMENT_UPLOAD_MAX_BYTES,
        10_000_000,
        "DOCUMENT_UPLOAD_MAX_BYTES",
      ),
      maxCharacters: positiveInteger(
        environment.DOCUMENT_EXTRACTION_MAX_CHARACTERS,
        managedDocumentContentLimit,
        "DOCUMENT_EXTRACTION_MAX_CHARACTERS",
      ),
      maxPdfPages: positiveInteger(
        environment.DOCUMENT_PDF_MAX_PAGES,
        100,
        "DOCUMENT_PDF_MAX_PAGES",
      ),
      maxDocxUncompressedBytes: positiveInteger(
        environment.DOCUMENT_DOCX_MAX_UNCOMPRESSED_BYTES,
        25_000_000,
        "DOCUMENT_DOCX_MAX_UNCOMPRESSED_BYTES",
      ),
    },
    staging: {
      lifetimeMs: positiveInteger(
        environment.DOCUMENT_STAGE_TTL_MS,
        15 * 60 * 1000,
        "DOCUMENT_STAGE_TTL_MS",
      ),
      maxDocuments: positiveInteger(
        environment.DOCUMENT_STAGE_MAX_DOCUMENTS,
        20,
        "DOCUMENT_STAGE_MAX_DOCUMENTS",
      ),
      maxTotalCharacters: positiveInteger(
        environment.DOCUMENT_STAGE_MAX_CHARACTERS,
        managedDocumentContentLimit * 10,
        "DOCUMENT_STAGE_MAX_CHARACTERS",
      ),
    },
    scout: { batchSize: positiveInteger(environment.GIG_FINDER_SCOUT_BATCH_SIZE,20,"GIG_FINDER_SCOUT_BATCH_SIZE"), concurrency: positiveInteger(environment.GIG_FINDER_SCOUT_CONCURRENCY,5,"GIG_FINDER_SCOUT_CONCURRENCY") },
  };
}

export async function createWebApplication(configuration: WebConfiguration) {
  const logging = createApplicationLogger({
    directory: configuration.context.logs,
    level: configuration.logLevel,
  });
  const aiSdkDevTools = await registerAiSdkDevTools(
    configuration.aiSdkDevTools,
  );
  const candidateProfile=loadCandidateProfile(configuration.context.profile);
  const profileHash=createHash("sha256").update(JSON.stringify(candidateProfile)).digest("hex");
  const screeningModel=configuration.defaultAgentModel;
  const screeningModelConfiguration="structured-v1:maxRetries=1";
  const local = openLocalApplication({
    database: configuration.context.database,
    artifacts: configuration.context.artifacts,
    profileDocuments: configuration.context.profileDocuments,
    scoutDescriptions: configuration.context.scoutDescriptions,
  }, {
    defaultAgentModel: configuration.defaultAgentModel,
    scoutDefaults: configuration.scout,
    scoutScreening:{profile:candidateProfile,profileVersion:candidateProfile.version,profileArtifactId:`candidate-profile:${profileHash}`,profileHash,model:screeningModel,provider:"openai-codex",modelConfiguration:screeningModelConfiguration},
    onProfileDocumentMaterializationFailure: (error, document) => logging.logger.error({
      event: "profile_document.materialization_failed",
      documentId: document.id,
      documentVersion: document.currentVersion,
      err: error,
    }, "Profile document materialization remains pending"),
  });
  const gigFinder = local.application;
  const scoutRuntime = new ScoutRuntime(local.scoutStore, {
    dataPath: configuration.context.scoutQueue,
    batchSize: configuration.scout.batchSize,
    concurrency: configuration.scout.concurrency,
    logger: logging.logger,
  });
  scoutRuntime.start();
  const screening=new AiSdkScoutScreeningModel(()=>createCodexLanguageModel(screeningModel,{...(configuration.smoke.providerBaseURL?{smokeBaseURL:configuration.smoke.providerBaseURL}:{}),surfaceLiveSmokeErrors:configuration.smoke.mode==="live"}),{provider:"openai-codex",model:screeningModel,configuration:screeningModelConfiguration});
  const scoutPositionRuntime=new ScoutPositionRuntime(local.scoutStore,new ScoutPositionProcessor(local.scoutStore,screening),{dataPath:configuration.context.scoutPositionQueue,batchSize:configuration.scout.batchSize,concurrency:configuration.scout.concurrency});
  scoutPositionRuntime.start();
  const stagedDocuments = new StagedDocumentService(configuration.staging);
  const uploadHandler = createDocumentUploadHandler(
    new LocalDocumentConverter(configuration.uploads),
    stagedDocuments,
    configuration.uploads.maxBytes,
  );
  const agentRuntime = new GigFinderConversationRuntime({
    profile: candidateProfile,
    profileDocuments: () => gigFinder.documents.profileContext(),
    logger: logging.logger,
    reads: {
      gigs: gigFinder.gigs,
      people: gigFinder.people,
      gigPeople: gigFinder.gigPeople,
      tasks: gigFinder.tasks,
      interactions: gigFinder.interactions,
      documents: gigFinder.documentReader,
    },
    mutations: gigFinder,
    actor: configuration.context.actor,
    toolExtensions: { contextSearch: gigFinder.contextSearch, stagedDocuments },
    selectModel: () => gigFinder.settings.get().agentModel,
    ...(configuration.smoke.mode
      ? { modelFactory: modelId => createCodexLanguageModel(modelId, {
          ...(configuration.smoke.providerBaseURL
            ? { smokeBaseURL: configuration.smoke.providerBaseURL }
            : {}),
          surfaceLiveSmokeErrors: configuration.smoke.mode === "live",
        }) }
      : {}),
    maxSteps: configuration.smoke.maxSteps,
    maxOutputTokens: configuration.smoke.maxOutputTokens,
  });
  const conversations = new ConversationService(
    local.conversations,
    {
      async read(documentId, version) {
        const result = await gigFinder.documentReader.get(documentId, version);
        return result.status === "ok" ? result : null;
      },
    },
    agentRuntime,
  );
  const agentApi = createAgentApi(conversations, logging.logger);
  const fetch = createWebHandler({
    gigFinder,
    agentApi,
    uploadHandler,
    discardStagedDocument: reference => stagedDocuments.discard(reference),
    requestLogger: logging.requestLogger,
    healthCheck: () => {
      const validation = local.validate();
      return {
        ok: validation.ok,
        revision: configuration.server.revision,
        integrity: validation.integrity,
        foreignKeyViolations: validation.foreignKeyViolations,
      };
    },
    staticFiles: configuration.server.staticRoot
      ? createStaticFileHandler(configuration.server.staticRoot)
      : undefined,
    scout: local.scout,
    scoutPositions:local.scoutPositions,
    importScoutCompany: value => importScoutCompany(
      value,
      local.scoutCompanyImportStore,
      scoutTemplateCatalog,
    ),
  });

  return {
    fetch,
    logger: logging.logger,
    diagnostics: {
      activeLogFile: logging.activeLogFile,
      logLevel: logging.level,
      aiSdkDevTools,
    },
    maxRequestBodySize: configuration.uploads.maxBytes + 1_000_000,
    close: async()=>{await scoutRuntime.close();await scoutPositionRuntime.close();local.close();},
  };
}

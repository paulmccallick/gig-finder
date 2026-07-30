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

const repoRoot = path.resolve(import.meta.dir, "../..");
const devToolsEnabled = await registerDevelopmentTelemetry();
const context = resolveJobSearchContext(repoRoot);
const local = openLocalApplication({
  database: context.database,
  artifacts: context.artifacts,
});
const jobSearch = local.application;
const port = Number(process.env.API_PORT ?? 3001);
const agentHandler = createAgentHandler(
  loadJobSearchProfile(context.profile),
  undefined,
  logger,
  jobSearch.agentContext,
  jobSearch,
  context.actor,
);
const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: createWebHandler({jobSearch,agentHandler,requestLogger}),
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

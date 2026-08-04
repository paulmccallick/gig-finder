import path from "node:path";
import { createWebApplication, loadWebConfiguration } from "./app";

const applicationRoot = path.resolve(import.meta.dir, "../..");
const configuration = loadWebConfiguration(applicationRoot);
const application = await createWebApplication(configuration);
const server = Bun.serve({
  hostname: configuration.server.hostname,
  port: configuration.server.port,
  maxRequestBodySize: application.maxRequestBodySize,
  fetch: application.fetch,
  error(error) {
    application.logger.error({
      event: "http.server.failed",
      err: error,
    }, "Unhandled server error");
    return Response.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  },
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop(true);
  application.close();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

application.logger.info({
  event: "server.started",
  address: `http://${configuration.server.hostname}:${configuration.server.port}`,
  revision: configuration.server.revision,
  ...application.diagnostics,
}, "GigFinder web server listening");

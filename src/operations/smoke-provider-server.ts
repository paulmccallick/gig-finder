import { createSmokeProviderState, smokeProviderHandler } from "../../scripts/smoke-support/scripted-provider";

const port = Number(process.env.PORT ?? "4010");
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("PORT must be a valid positive port.");
}

const state = createSmokeProviderState();
const server = Bun.serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  port,
  fetch: smokeProviderHandler(state),
});

const stop = () => void server.stop(true);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

console.log(JSON.stringify({ event: "smoke-provider.started", port: server.port }));

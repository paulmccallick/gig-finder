import { mkdirSync } from "node:fs";
import path from "node:path";
import pino, { type Logger } from "pino";
import { createStream } from "rotating-file-stream";

export const configuredLogLevel = process.env.LOG_LEVEL?.trim() || "debug";
export const logDirectory = path.resolve(
  process.env.LOG_DIRECTORY?.trim()
    || path.join(
      process.env.JOB_SEARCH_CONTEXT_ROOT?.trim()
        || path.join(import.meta.dir, "../..", "context"),
      "logs",
    ),
);
export const activeLogFile = path.join(logDirectory, "server.log");

mkdirSync(logDirectory, { recursive: true });

const logStream = createStream("server.log", {
  path: logDirectory,
  size: "10M",
  maxFiles: 5,
  history: "rotation-history.txt",
  teeToStdout: true,
});

export const logger = pino({
  level: configuredLogLevel,
  base: {
    service: "job-search-server",
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "request.headers.authorization",
      "request.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
}, logStream);

export function requestLogger(requestId: string): Logger {
  return logger.child({ requestId });
}

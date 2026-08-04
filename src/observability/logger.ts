import { mkdirSync } from "node:fs";
import path from "node:path";
import pino, { type Logger } from "pino";
import { createStream } from "rotating-file-stream";

export interface ApplicationLoggerOptions {
  directory: string;
  level: string;
}

export interface ApplicationLogging {
  logger: Logger;
  requestLogger(requestId: string): Logger;
  activeLogFile: string;
  level: string;
}

export function createApplicationLogger(
  options: ApplicationLoggerOptions,
): ApplicationLogging {
  const directory = path.resolve(options.directory);
  const activeLogFile = path.join(directory, "server.log");
  mkdirSync(directory, { recursive: true });
  const logStream = createStream("server.log", {
    path: directory,
    size: "10M",
    maxFiles: 5,
    history: "rotation-history.txt",
    teeToStdout: true,
  });
  const logger = pino({
    level: options.level,
    base: {
      service: "gig-finder-server",
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

  return {
    logger,
    requestLogger: requestId => logger.child({ requestId }),
    activeLogFile,
    level: options.level,
  };
}

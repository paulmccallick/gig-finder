import pino, { type Logger } from "pino";

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
  });

  return {
    logger,
    requestLogger: requestId => logger.child({ requestId }),
    activeLogFile: "stdout",
    level: options.level,
  };
}

import type { Logger } from "pino";
import type { RepositoryTelemetry } from "./repositories/audited-port";

export function createSqliteTelemetry(logger: Logger): RepositoryTelemetry {
  return {
    record(event) {
      const payload = {
        event: "sqlite.repository",
        operation: event.operation,
        entity: event.entity,
        phase: event.phase,
        durationMs: Math.round(event.durationMs * 100) / 100,
        success: event.success,
        ...(event.error ? { err: event.error } : {}),
      };
      if (event.success) logger.info(payload, "SQLite repository operation");
      else logger.error(payload, "SQLite repository operation failed");
    },
  };
}

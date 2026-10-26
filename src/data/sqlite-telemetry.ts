import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "bun:sqlite";

export interface SqliteTelemetryLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

const operationContext = new AsyncLocalStorage<string>();

export function withDatabaseOperation<T>(operation: string, action: () => T): T {
  return operationContext.run(operation, action);
}

const statementShape = (sql: string) =>
  sql.replace(/\s+/g, " ").replace(/'[^']*'/g, "?{}").replace(/\b\d+(?:\.\d+)?\b/g, "?n").trim();

const operationFor = (sql: string) =>
  /^\s*(select|insert|update|delete|replace|with|pragma)\b/i.exec(sql)?.[1]?.toLowerCase() ?? "other";

export function instrumentDatabase(database: Database, logger?: SqliteTelemetryLogger): Database {
  if (!logger) return database;
  const instrumentStatement = (statement: ReturnType<Database["query"]>, sql: string) => new Proxy(statement, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "get" && property !== "all" && property !== "run") return value;
      return (...parameters: unknown[]) => {
        const execute = value as (...args: unknown[]) => unknown;
        const startedAt = performance.now();
        const context = operationContext.getStore() ?? "database.unscoped";
        try {
          const result = execute.apply(target, parameters);
          const durationMs = Math.round(performance.now() - startedAt);
          const fields: Record<string, unknown> = {
            event: "database.query",
            operation: context,
            phase: property,
            sqlOperation: operationFor(sql),
            statementHash: Bun.hash(statementShape(sql)).toString(16),
            durationMs,
            ...(property === "run"
              ? { changes: (result as { changes?: number }).changes ?? null }
              : { rowCount: Array.isArray(result) ? result.length : result ? 1 : 0 }),
          };
          logger.info(fields, "SQLite query completed");
          return result;
        } catch (error) {
          logger.error({
            event: "database.query_failed",
            operation: context,
            phase: property,
            sqlOperation: operationFor(sql),
            statementHash: Bun.hash(statementShape(sql)).toString(16),
            durationMs: Math.round(performance.now() - startedAt),
            errorCode: error instanceof Error ? error.message.slice(0, 200) : "unknown",
          }, "SQLite query failed");
          throw error;
        }
      };
    },
  });
  return new Proxy(database, {
    get(target, property) {
      if (property === "query") return (sql: string) => instrumentStatement(target.query(sql), sql);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

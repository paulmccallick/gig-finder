import { OptimisticConcurrencyError } from "../core/errors";

export class DataError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DataError"; }
}
export class NotFoundError extends DataError {
  constructor(entity: string, id: string) { super("NOT_FOUND", `${entity} not found: ${id}`); }
}
export class DeletedRecordError extends DataError {
  constructor(entity: string, id: string) { super("RECORD_DELETED", `${entity} is deleted: ${id}`); }
}
export class RevisionConflictError extends OptimisticConcurrencyError {
  constructor(public readonly entity: string, public readonly id: string, public readonly expectedRevision: number, public readonly actualRevision: number) {
    super(`${entity} ${id} expected revision ${expectedRevision}, actual revision ${actualRevision}`);
    this.name = "RevisionConflictError";
  }
}

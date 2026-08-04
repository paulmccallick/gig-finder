export class DomainValidationError extends Error {
  readonly code = "domain_validation_failed";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainValidationError";
  }
}

export class OptimisticConcurrencyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OptimisticConcurrencyError";
  }
}

export class PersistenceConsistencyError extends Error {
  readonly code = "consistency_error";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceConsistencyError";
  }
}

export type MutationErrorCode =
  | "duplicate_change"
  | "not_found"
  | "not_revertible"
  | "revision_conflict";

export class MutationError extends Error {
  constructor(
    readonly code: MutationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MutationError";
  }
}

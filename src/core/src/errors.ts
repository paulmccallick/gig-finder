export class DomainValidationError extends Error {
  readonly code = "domain_validation_failed";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainValidationError";
  }
}

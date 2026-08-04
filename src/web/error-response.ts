import { DomainValidationError } from "../core";
import { WebRequestError } from "./agent-handler";

export interface WebError {
  status: number;
  body: {
    error: string;
    code?: string;
  };
}

export function toWebError(error: unknown): WebError {
  if (error instanceof WebRequestError) {
    return { status: error.status, body: { error: error.message } };
  }
  if (error instanceof DomainValidationError) {
    return {
      status: 422,
      body: { error: error.message, code: error.code },
    };
  }
  return { status: 500, body: { error: "Unknown server error" } };
}

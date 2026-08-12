import type {
  SourceAttempt,
  SourceConfiguration,
  SourceOutcome,
} from "../contracts";
import type { GigScoutClock, GigScoutHttpPort } from "../ports";
import { planSourceRequest } from "../source-plan";
import { extractJson } from "../extractors/json";
import { extractHtml } from "../extractors/html";
import { validatePositions } from "../diagnostics";
import {
  adpListingRequest,
  extractPlatform,
  platformRequest,
} from "./platform";

const bounded = (value: unknown, fallback: string) =>
  (value instanceof Error ? value.message : fallback).slice(0, 500);
const retryable = (error: unknown) =>
  !(error instanceof DOMException && error.name === "AbortError") &&
  (!String(error).match(/http_4\d\d/) || String(error).includes("http_429"));
export async function scanSource(
  source: SourceConfiguration,
  http: GigScoutHttpPort,
  clock: GigScoutClock,
  signal?: AbortSignal,
): Promise<SourceOutcome> {
  const positions = [];
  const attempts: SourceAttempt[] = [];
  let surfaceVerified = false;
  let terminalError: unknown;
  const terms =
    source.type === "platform" && source.searchTerms.length
      ? source.searchTerms
      : [""];
  for (const [termIndex, term] of terms.entries())
    for (let page = 1; page <= source.maxPages; page++) {
      let pageComplete = false;
      for (let retry = 0; retry < 3 && !pageComplete; retry++) {
        const startedAt = clock.now().toISOString();
        try {
          signal?.throwIfAborted();
          const plan =
            source.type === "platform"
              ? platformRequest(source, page, term)
              : planSourceRequest(source, page);
          let response = await http.request({
            ...plan,
            headers: {
              accept: source.type === "html" ? "text/html" : "application/json",
              ...(plan.body ? { "content-type": "application/json" } : {}),
              ...plan.headers,
            },
            timeoutMs: 15_000,
            maxResponseBytes: 5_000_000,
            signal,
          });
          if (response.status < 200 || response.status >= 300)
            throw new Error(`http_${response.status}`);
          let requestCount = 1,
            responseCount = 1;
          if (
            source.type === "platform" &&
            source.adapter === "adp" &&
            !source.url.includes("apply-custom-filters")
          ) {
            const listing = adpListingRequest(source, response.body);
            if (!listing) throw new Error("adp_configuration_invalid");
            response = await http.request({
              ...listing,
              headers: { accept: "application/json", ...listing.headers },
              timeoutMs: 15_000,
              maxResponseBytes: 5_000_000,
              signal,
            });
            requestCount++;
            if (response.status < 200 || response.status >= 300)
              throw new Error(`http_${response.status}`);
            responseCount++;
          }
          const extracted =
            source.type === "json"
              ? extractJson(source, response.body)
              : source.type === "platform"
                ? extractPlatform(source, response.body, page)
                : { ...extractHtml(source, response.body), hasNext: false };
          positions.push(...extracted.positions);
          surfaceVerified ||= extracted.surfaceVerified;
          pageComplete = true;
          attempts.push({
            adapter: source.type,
            stage: `listing${terms.length > 1 ? `_term_${termIndex + 1}` : ""}_page_${page}`,
            requestCount,
            responseCount,
            candidateCount: extracted.positions.length,
            acceptedCount: 0,
            rejectedCount: 0,
            validationStatus: "verified",
            startedAt,
            completedAt: clock.now().toISOString(),
            diagnostics: [],
          });
          if (!extracted.hasNext || source.type === "html")
            page = source.maxPages;
        } catch (error) {
          if (signal?.aborted) throw error;
          terminalError = error;
          attempts.push({
            adapter: source.type,
            stage: `listing${terms.length > 1 ? `_term_${termIndex + 1}` : ""}_page_${page}`,
            requestCount: 1,
            responseCount: 0,
            candidateCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            validationStatus: "failed",
            startedAt,
            completedAt: clock.now().toISOString(),
            failure: {
              code:
                error instanceof DOMException && error.name === "AbortError"
                  ? "request_timeout"
                  : "source_attempt_failed",
              message: bounded(error, "Source attempt failed."),
            },
            diagnostics: [],
          });
          if (!retryable(error)) retry = 3;
        }
      }
      if (!pageComplete) {
        if (positions.length) {
          const validation = validatePositions(positions, surfaceVerified);
          const final = attempts.at(-1)!;
          final.acceptedCount = validation.accepted.length;
          final.rejectedCount = validation.rejected;
          final.diagnostics = validation.diagnostics;
          return {
            sourceKey: source.key,
            status: "partial",
            positions: validation.accepted,
            attempts,
          };
        }
        return {
          sourceKey: source.key,
          status: "failed",
          positions: [],
          attempts: attempts.length
            ? attempts
            : [
                {
                  adapter: source.type,
                  stage: "listing",
                  requestCount: 0,
                  responseCount: 0,
                  candidateCount: 0,
                  acceptedCount: 0,
                  rejectedCount: 0,
                  validationStatus: "failed",
                  startedAt: clock.now().toISOString(),
                  completedAt: clock.now().toISOString(),
                  failure: {
                    code: "source_failed",
                    message: bounded(terminalError, "Source failed."),
                  },
                  diagnostics: [],
                },
              ],
        };
      }
    }
  const validation = validatePositions(positions, surfaceVerified);
  const final = attempts.at(-1)!;
  final.acceptedCount = validation.accepted.length;
  final.rejectedCount = validation.rejected;
  final.validationStatus =
    validation.status === "suspicious_empty" ? "suspicious" : "verified";
  final.diagnostics = validation.diagnostics;
  return {
    sourceKey: source.key,
    status: validation.status,
    positions: validation.accepted,
    attempts,
  };
}

import type {
  SourceAttempt,
  SourceConfiguration,
  SourceOutcome,
  NormalizedPosition,
  ScoutRuntimePolicy,
  ScoutSearchProfile,
} from "../contracts";
import type { GigScoutClock, GigScoutHttpPort } from "../ports";
import { validatePositions } from "../diagnostics";
import { sourceAdapter } from "./registry";
import type { TemplateResolver } from "./templates/definitions";

const bounded = (value: unknown, fallback: string) =>
  (value instanceof Error ? value.message : fallback).slice(0, 500);
const retryable = (error: unknown) =>
  !(error instanceof DOMException && error.name === "AbortError") &&
  (!String(error).match(/http_4\d\d/) || String(error).includes("http_429"));
type SourceScanResult = Omit<SourceOutcome, "positions"> & {
  positions: Array<Omit<NormalizedPosition, "company">>;
};
export async function scanSource(
  source: SourceConfiguration,
  searchProfile: ScoutSearchProfile,
  policy: ScoutRuntimePolicy,
  http: GigScoutHttpPort,
  clock: GigScoutClock,
  templates: TemplateResolver,
  signal?: AbortSignal,
): Promise<SourceScanResult> {
  const positions: Array<Omit<NormalizedPosition, "company">> = [];
  const attempts: SourceAttempt[] = [];
  const attemptPositions: Array<{
    attempt: SourceAttempt;
    positions: Array<Omit<NormalizedPosition, "company">>;
  }> = [];
  let surfaceVerified = false;
  let terminalError: unknown;
  let nextHtmlPageUrl: string | null = null;
  const sourceStartedAt = clock.now().getTime();
  const adapter = sourceAdapter(source, templates);
  const terms = adapter.terms(source, searchProfile);
  for (const [termIndex, term] of terms.entries()) {
    const termIdentities = new Set<string>();
    let termRecordsReceived = 0;
    let exhausted = false;
    for (let page = 1; ; page++) {
      if (
        page > policy.maxPages ||
        attempts.reduce((sum, attempt) => sum + attempt.requestCount, 0) >=
          policy.maxRequests ||
        positions.length >= policy.maxRecords ||
        clock.now().getTime() - sourceStartedAt >= policy.sourceDurationMs
      ) {
        const final = attempts.at(-1);
        final?.diagnostics.push({
          code: "source_limit_reached",
          category: "validation",
          count: 1,
          message:
            "Runtime safety policy was reached before source exhaustion was proven.",
        });
        if (final) final.validationStatus = "failed";
        const validation = validatePositions(
          positions,
          surfaceVerified,
          searchProfile,
        );
        applyValidation(
          attemptPositions,
          validation.accepted,
          validation.rejectedPositions,
          validation.filterDecisions,
        );
        return {
          sourceKey: source.key,
          status: validation.accepted.length ? "partial" : "failed",
          positions: validation.accepted,
          attempts,
        };
      }
      let pageComplete = false;
      for (let retry = 0; retry <= policy.retries && !pageComplete; retry++) {
        const startedAt = clock.now().toISOString();
        try {
          signal?.throwIfAborted();
          const plan = adapter.request(
            source,
            page,
            term,
            nextHtmlPageUrl,
            searchProfile,
          );
          let response = await http.request({
            ...plan,
            headers: {
              accept:
                source.type === "html" ||
                (source.type === "json" &&
                  "scriptEnvelope" in source &&
                  source.scriptEnvelope)
                  ? "text/html"
                  : "application/json",
              ...(plan.body ? { "content-type": "application/json" } : {}),
              ...plan.headers,
            },
            timeoutMs: 15_000,
            maxResponseBytes: policy.maxListingBytes,
            signal,
          });
          if (response.status < 200 || response.status >= 300)
            throw new Error(`http_${response.status}`);
          let requestCount = 1,
            responseCount = 1;
          const listing = await adapter.followupRequest?.(
            source,
            response.body,
            response.headers,
            page,
            term,
          );
          if (listing) {
            response = await http.request({
              ...listing,
              headers: { accept: "application/json", ...listing.headers },
              timeoutMs: 15_000,
              maxResponseBytes: policy.maxListingBytes,
              signal,
            });
            requestCount++;
            if (response.status < 200 || response.status >= 300)
              throw new Error(`http_${response.status}`);
            responseCount++;
          }
          const extracted = await adapter.decode(source, response.body, page);
          const enrichmentDiagnostics = [];
          for (const [positionIndex, position] of extracted.positions.entries()) {
            const enrichment = adapter.enrichmentRequest?.(source, position);
            if (!enrichment) continue;
            if (attempts.reduce((sum, attempt) => sum + attempt.requestCount, 0) + requestCount >= policy.maxRequests) {
              enrichmentDiagnostics.push({
                code: "location_enrichment_budget_exhausted",
                category: "validation" as const,
                count: 1,
                message: "Aggregate location detail was unavailable within the source request budget; location filtering was deferred.",
              });
              continue;
            }
            try {
              const detailResponse = await http.request({
                ...enrichment,
                headers: { accept: "application/json", ...enrichment.headers },
                timeoutMs: 15_000,
                maxResponseBytes: policy.maxDetailBytes,
                signal,
              });
              requestCount++;
              if (detailResponse.status < 200 || detailResponse.status >= 300) {
                enrichmentDiagnostics.push({
                  code: "location_enrichment_http_failed",
                  category: "network" as const,
                  count: 1,
                  message: "Aggregate location detail returned a non-success response; location filtering was deferred.",
                });
                continue;
              }
              responseCount++;
              extracted.positions[positionIndex] = adapter.enrich?.(
                source,
                position,
                detailResponse.body,
              ) ?? position;
            } catch (error) {
              if (signal?.aborted || String(error).includes("response_too_large")) throw error;
              requestCount++;
              enrichmentDiagnostics.push({
                code: "location_enrichment_request_failed",
                category: "network" as const,
                count: 1,
                message: "Aggregate location detail could not be retrieved; location filtering was deferred.",
              });
            }
          }
          nextHtmlPageUrl = extracted.nextPageUrl ?? null;
          const identities = extracted.positions.map(
            (position) =>
              `${position.sourceKey}\0${position.externalId ?? position.canonicalUrl}`,
          );
          const uniqueIdentities = identities.filter(
            (identity) => !termIdentities.has(identity),
          );
          uniqueIdentities.forEach((identity) => termIdentities.add(identity));
          const reconciliationDiagnostics = [...(extracted.diagnostics ?? [])];
          if (
            extracted.sourceReportedTotal !== null &&
            extracted.sourceReportedTotal > 0 &&
            extracted.recordsReceived === 0
          )
            reconciliationDiagnostics.push({
              code: "reported_records_missing",
              category: "extraction" as const,
              count: extracted.sourceReportedTotal,
              message:
                "The source reported records but returned no inspectable records.",
            });
          if (extracted.recordsReceived > 0 && extracted.positions.length === 0)
            reconciliationDiagnostics.push({
              code: "records_not_normalized",
              category: "extraction" as const,
              count: extracted.recordsReceived,
              message:
                "Records were received but none could be normalized for evaluation.",
            });
          if (
            page > 1 &&
            extracted.recordsReceived > 0 &&
            uniqueIdentities.length === 0
          )
            reconciliationDiagnostics.push({
              code: "pagination_replayed",
              category: "validation" as const,
              count: extracted.recordsReceived,
              message: "This page contributed no distinct position identities.",
            });
          if (extracted.hasNext && extracted.recordsReceived === 0)
            reconciliationDiagnostics.push({
              code: "pagination_empty_before_exhaustion",
              category: "validation" as const,
              count: 1,
              message:
                "The source advertised another page but returned no records before exhaustion.",
            });
          const reconciled = reconciliationDiagnostics.length === 0;
          positions.push(...extracted.positions);
          termRecordsReceived += extracted.recordsReceived;
          surfaceVerified ||= extracted.surfaceVerified && reconciled;
          pageComplete = true;
          const attempt: SourceAttempt = {
            sourceMethod: source.type,
            stage: `listing${terms.length > 1 ? `_term_${termIndex + 1}` : ""}_page_${page}`,
            requestCount,
            responseCount,
            sourceReportedTotal: extracted.sourceReportedTotal,
            recordsReceived: extracted.recordsReceived,
            recordsParsed: extracted.positions.length,
            recordsEvaluable: extracted.positions.length,
            recordsEvaluated: extracted.positions.length,
            candidateCount: extracted.positions.length,
            acceptedCount: reconciled ? extracted.positions.length : 0,
            rejectedCount:
              extracted.recordsReceived - extracted.positions.length,
            pagesRequested: 1,
            pagesValidated: extracted.surfaceVerified && reconciled ? 1 : 0,
            uniqueIdentities: uniqueIdentities.length,
            validationStatus:
              reconciled && extracted.surfaceVerified ? "verified" : "failed",
            startedAt,
            completedAt: clock.now().toISOString(),
            diagnostics: [...reconciliationDiagnostics, ...enrichmentDiagnostics],
          };
          attempts.push(attempt);
          attemptPositions.push({ attempt, positions: extracted.positions });
          if (!reconciled)
            return {
              sourceKey: source.key,
              status: "failed",
              positions: [],
              attempts,
            };
          if (!extracted.hasNext) {
            exhausted = true;
            break;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          terminalError = error;
          attempts.push({
            sourceMethod: source.type,
            stage: `listing${terms.length > 1 ? `_term_${termIndex + 1}` : ""}_page_${page}`,
            requestCount: 1,
            responseCount: 0,
            sourceReportedTotal: null,
            recordsReceived: 0,
            recordsParsed: 0,
            recordsEvaluable: 0,
            recordsEvaluated: 0,
            candidateCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            pagesRequested: 1,
            pagesValidated: 0,
            uniqueIdentities: 0,
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
          if (!retryable(error)) retry = policy.retries + 1;
        }
      }
      if (!pageComplete) {
        if (positions.length) {
          const validation = validatePositions(
            positions,
            surfaceVerified,
            searchProfile,
          );
          applyValidation(
            attemptPositions,
            validation.accepted,
            validation.rejectedPositions,
            validation.filterDecisions,
          );
          attempts
            .at(-1)!
            .diagnostics.push(
              ...validation.diagnostics.filter(
                (diagnostic) =>
                  diagnostic.code === "listing_surface_unverified",
              ),
            );
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
                  sourceMethod: source.type,
                  stage: "listing",
                  requestCount: 0,
                  responseCount: 0,
                  sourceReportedTotal: null,
                  recordsReceived: 0,
                  recordsParsed: 0,
                  recordsEvaluable: 0,
                  recordsEvaluated: 0,
                  candidateCount: 0,
                  acceptedCount: 0,
                  rejectedCount: 0,
                  pagesRequested: 0,
                  pagesValidated: 0,
                  uniqueIdentities: 0,
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
      if (exhausted) break;
      if (!attempts.at(-1)?.stage.endsWith(`page_${page}`)) continue;
      const lastAttempt = attempts.at(-1)!;
      if (
        lastAttempt.sourceReportedTotal !== null &&
        lastAttempt.sourceReportedTotal !== undefined &&
        termRecordsReceived >= lastAttempt.sourceReportedTotal
      )
        break;
      if (source.type === "html" && nextHtmlPageUrl === null) break;
      if (lastAttempt.recordsReceived === 0) break;
    }
  }
  const validation = validatePositions(
    positions,
    surfaceVerified,
    searchProfile,
  );
  applyValidation(
    attemptPositions,
    validation.accepted,
    validation.rejectedPositions,
    validation.filterDecisions,
  );
  const final = attempts.at(-1)!;
  final.validationStatus =
    validation.status === "suspicious_empty" ? "suspicious" : "verified";
  final.diagnostics.push(
    ...validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "listing_surface_unverified",
    ),
  );
  return {
    sourceKey: source.key,
    status: validation.status,
    positions: validation.accepted,
    attempts,
  };
}

function applyValidation(
  batches: Array<{
    attempt: SourceAttempt;
    positions: Array<Omit<NormalizedPosition, "company">>;
  }>,
  accepted: Array<Omit<NormalizedPosition, "company">>,
  rejected: Array<{
    position: Omit<NormalizedPosition, "company">;
    code: string;
    message: string;
  }>,
  decisions: NonNullable<SourceAttempt["filterDecisions"]>,
) {
  const acceptedPositions = new Set(accepted);
  for (const batch of batches) {
    const acceptedCount = batch.positions.filter((position) =>
      acceptedPositions.has(position),
    ).length;
    batch.attempt.acceptedCount = acceptedCount;
    batch.attempt.rejectedCount =
      batch.attempt.recordsReceived! - acceptedCount;
    const identities = new Set(batch.positions.map((position) =>
      `${position.sourceKey}\0${position.externalId ?? position.canonicalUrl}`,
    ));
    batch.attempt.filterDecisions = decisions.filter((decision) => identities.has(decision.identity));
    const reasons = new Map<string, { count: number; message: string }>();
    for (const rejection of rejected) {
      if (!batch.positions.includes(rejection.position)) continue;
      const reason = reasons.get(rejection.code) ?? {
        count: 0,
        message: rejection.message,
      };
      reason.count++;
      reasons.set(rejection.code, reason);
    }
    batch.attempt.diagnostics.push(
      ...[...reasons].map(([code, reason]) => ({
        code,
        category: "validation" as const,
        count: reason.count,
        message: reason.message,
      })),
    );
  }
}

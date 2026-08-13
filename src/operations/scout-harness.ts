import { scoutCompanyImportSchema } from "../core/scout/engine/company-import";
import { isIP } from "node:net";
import {
  BoundedFetchHttpPort,
  scanCompany,
  scoutSearchProfileSchema,
  type NormalizedPosition,
  type SourceConfiguration,
} from "../core/scout/engine";
import { scoutTemplateCatalog } from "./scout-template-catalog";

export interface ScoutHarnessSelection {
  companyId?: string;
  sourceKey?: string;
  template?: string;
  term?: string;
  maxPages: number;
}

export const crediblePosting = (position: NormalizedPosition, body: string) => {
  const url = new URL(position.canonicalUrl),
    title = position.title.trim(),
    tokens = title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
  return (
    title.length >= 3 &&
    url.protocol === "https:" &&
    url.pathname !== "/" &&
    (tokens.length
      ? tokens.some((token) => body.toLowerCase().includes(token))
      : body.toLowerCase().includes(title.toLowerCase()))
  );
};

const safeOfficialHost = (url: URL) => {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) return false;
  if (!isIP(hostname)) return true;
  return !(
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("127.") ||
    hostname.startsWith("169.254.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
};

async function fetchOfficialDetail(
  position: NormalizedPosition,
  http: BoundedFetchHttpPort,
) {
  const detailUrl =
    position.provenance.descriptionUrl ?? position.canonicalUrl;
  const initial = new URL(detailUrl);
  if (!safeOfficialHost(initial))
    throw new Error("Detail URL did not use a public HTTPS host.");
  let current = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await http.request({
      url: current.toString(),
      method: "GET",
      headers: { accept: "text/html, application/json" },
      timeoutMs: 15_000,
      maxResponseBytes: 6_000_000,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new Error("Detail redirect omitted its location.");
      const next = new URL(location, current);
      if (!safeOfficialHost(next))
        throw new Error("Detail redirect did not use a public HTTPS host.");
      current = next;
      continue;
    }
    return { status: response.status, body: response.body };
  }
  throw new Error("Detail response exceeded the redirect limit.");
}
export async function runScoutHarness(
  raw: unknown,
  selection: ScoutHarnessSelection,
) {
  const input = raw as { searchProfile?: unknown },
    searchProfile = scoutSearchProfileSchema.parse(input.searchProfile ?? {}),
    config = scoutCompanyImportSchema.parse(
      raw && typeof raw === "object"
        ? Object.fromEntries(
            Object.entries(raw).filter(([key]) => key !== "searchProfile"),
          )
        : raw,
    ),
    http = new BoundedFetchHttpPort(),
    reports = [];
  for (const company of config.companies) {
    if (selection.companyId && company.id !== selection.companyId) continue;
    for (const configured of company.sources) {
      if (selection.sourceKey && configured.key !== selection.sourceKey)
        continue;
      if (
        selection.template &&
        (configured.type === "json" && "template" in configured
          ? configured.template.id !== selection.template
          : configured.type !== selection.template)
      )
        continue;
      const source = configured as SourceConfiguration;
      const result = await scanCompany(
          {
            companyId: company.id,
            configurationVersionId: "direct-harness",
            sources: [source],
            searchProfile: {
              terms:
                selection.term === undefined
                  ? searchProfile.terms
                  : [selection.term],
              locations: searchProfile.locations,
            },
          },
          {
            http,
            templates: scoutTemplateCatalog,
            policy: { maxPages: selection.maxPages },
          },
        ),
        outcome = result.sources[0]!;
      const samples = [];
      for (const position of outcome.positions.slice(0, 3)) {
        let semantic = false,
          status = 0,
          failure: string | null = null;
        for (let attempt = 0; attempt < 3 && !semantic; attempt++) {
          try {
            const response = await fetchOfficialDetail(position, http);
            status = response.status;
            semantic =
              response.status >= 200 &&
              response.status < 400 &&
              (crediblePosting(position, response.body) ||
                (Boolean(position.description) &&
                  crediblePosting(position, position.description ?? "")));
            failure = null;
          } catch (error) {
            failure = (
              error instanceof Error ? error.message : "Detail request failed"
            ).slice(0, 500);
          }
        }
        samples.push({
          title: position.title,
          url: position.canonicalUrl,
          status,
          semantic,
          failure,
        });
      }
      const attempts = outcome.attempts.map((attempt) => ({
        stage: attempt.stage,
        sourceReportedTotal: attempt.sourceReportedTotal ?? null,
        recordsReceived: attempt.recordsReceived ?? 0,
        recordsParsed: attempt.recordsParsed ?? 0,
        recordsEvaluable: attempt.recordsEvaluable ?? 0,
        recordsEvaluated: attempt.recordsEvaluated ?? 0,
        accepted: attempt.acceptedCount,
        rejected: attempt.rejectedCount,
        pagesRequested: attempt.pagesRequested ?? 0,
        pagesValidated: attempt.pagesValidated ?? 0,
        uniqueIdentities: attempt.uniqueIdentities ?? 0,
        validationStatus: attempt.validationStatus,
        failureCode: attempt.failure?.code ?? null,
        failureMessage: attempt.failure?.message ?? null,
        diagnostics: attempt.diagnostics,
      }));
      const paginationValid = paginationEvidenceIsValid(
        attempts,
        selection.maxPages,
        source.type === "json" && "template" in source
          ? scoutTemplateCatalog.resolve(source.template).exhaustion.mode
          : undefined,
      );
      const passed =
        outcome.status.startsWith("succeeded_") &&
        outcome.status !== "succeeded_empty_verified"
          ? samples.length > 0 &&
            samples.every((sample) => sample.semantic) &&
            paginationValid
          : outcome.status === "succeeded_empty_verified" &&
            attempts.every(
              (attempt) => attempt.validationStatus === "verified",
            ) &&
            paginationValid;
      reports.push({
        companyId: company.id,
        sourceKey: source.key,
        sourceMethod: source.type,
        template:
          source.type === "json" && "template" in source
            ? source.template
            : null,
        status: outcome.status,
        passed,
        paginationValid,
        attempts,
        samples,
      });
    }
  }
  return {
    passed: reports.length > 0 && reports.every((report) => report.passed),
    sourceCount: reports.length,
    reports,
  };
}

export function paginationEvidenceIsValid(
  attempts: Array<{
    stage: string;
    pagesValidated: number;
    uniqueIdentities: number;
    sourceReportedTotal?: number | null;
    recordsReceived?: number;
  }>,
  maxPages: number,
  exhaustionMode?: "reported-total" | "single-response",
): boolean {
  if (maxPages < 2) return true;

  const secondPageAttempts = attempts.filter((attempt) =>
    attempt.stage.endsWith("page_2"),
  );
  if (secondPageAttempts.length === 0) {
    if (exhaustionMode === "single-response") return true;
    const firstPageAttempts = attempts.filter((attempt) =>
      attempt.stage.endsWith("page_1"),
    );
    return firstPageAttempts.some(
      (attempt) =>
        typeof attempt.sourceReportedTotal === "number" &&
        typeof attempt.recordsReceived === "number" &&
        attempt.sourceReportedTotal <= attempt.recordsReceived,
    );
  }

  return secondPageAttempts.some(
    (attempt) =>
      attempt.pagesValidated === 1 && attempt.uniqueIdentities > 0,
  );
}

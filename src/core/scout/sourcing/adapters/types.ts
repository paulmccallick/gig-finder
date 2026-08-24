import type {
  NormalizedPosition,
  ScoutSearchProfile,
  SourceConfiguration,
} from "../contracts";
import type { PlannedRequest } from "../source-plan";

export interface SourcePage {
  positions: NormalizedPosition[];
  hasNext: boolean;
  nextPageUrl?: string | null;
  surfaceVerified: boolean;
  sourceReportedTotal: number | null;
  recordsReceived: number;
  titleBearingNodes?: number;
  urlBearingNodes?: number;
  diagnostics?: Array<{
    code: string;
    category: "extraction" | "validation" | "network";
    count: number;
    message: string;
  }>;
}

export interface SourceAdapter {
  terms(source: SourceConfiguration, profile?: { terms: string[] }): string[];
  request(
    source: SourceConfiguration,
    page: number,
    term: string,
    nextPageUrl: string | null,
    profile: ScoutSearchProfile,
  ): PlannedRequest;
  followupRequest?(
    source: SourceConfiguration,
    responseBody: string,
    responseHeaders: Record<string, string>,
    page: number,
    term: string,
  ): PlannedRequest | null | Promise<PlannedRequest | null>;
  decode(
    source: SourceConfiguration,
    body: string,
    page: number,
  ): SourcePage | Promise<SourcePage>;
  enrichmentRequest?(
    source: SourceConfiguration,
    position: NormalizedPosition,
  ): PlannedRequest | null;
  enrich?(
    source: SourceConfiguration,
    position: NormalizedPosition,
    body: string,
  ): NormalizedPosition;
}

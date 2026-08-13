import type { ScoutSearchProfile, SourceConfiguration } from "../../contracts";
import type { PlannedRequest } from "../../source-plan";
export type ReusableJsonTemplateSource = Extract<SourceConfiguration, { template: unknown }>;
export interface ReusableJsonRequestHook {
  request(
    source: ReusableJsonTemplateSource,
    page: number,
    term: string,
    profile?: ScoutSearchProfile,
  ): PlannedRequest;
  listingRequest?(
    source: ReusableJsonTemplateSource,
    configurationBody: string,
    configurationHeaders: Record<string, string>,
    page: number,
    term: string,
  ): PlannedRequest | null | Promise<PlannedRequest | null>;
}

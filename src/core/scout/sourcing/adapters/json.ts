import type { ScoutSearchProfile, SourceConfiguration } from "../contracts";
import { extractJsonScriptEnvelope } from "../extractors/json";
import { planSourceRequest } from "../source-plan";
import { reusableJsonRequestHook } from "./templates/registry";
import { decodeReusableJson } from "./templates/support";
import { planReusableJsonRequest } from "./templates/request";
import type { TemplateResolver } from "./templates/definitions";
import type { SourceAdapter } from "./types";

export class JsonSourceAdapter implements SourceAdapter {
  constructor(private readonly templates: TemplateResolver) {}
  terms(source: SourceConfiguration, profile?: { terms: string[] }) {
    if (source.type !== "json") throw new Error("json_source_required");
    if ("template" in source)
      return profile?.terms.length ? profile.terms : [""];
    return [""];
  }
  request(
    source: SourceConfiguration,
    page: number,
    term: string,
    nextPageUrl: string | null,
    profile: ScoutSearchProfile,
  ) {
    if (source.type !== "json") throw new Error("json_source_required");
    if ("template" in source) {
      const definition = this.templates.resolve(source.template);
      const declarative = planReusableJsonRequest(
        source,
        page,
        term,
        definition,
      );
      if (declarative) return declarative;
      const hook = reusableJsonRequestHook(definition.requestHook);
      if (!hook)
        throw new Error(`${source.template.id}_request_definition_missing`);
      return hook.request(source, page, term, profile);
    }
    if (nextPageUrl && source.method === "GET")
      return { url: nextPageUrl, method: "GET" as const };
    return planSourceRequest(source, page);
  }
  async followupRequest(
    source: SourceConfiguration,
    responseBody: string,
    responseHeaders: Record<string, string>,
    page: number,
    term: string,
  ) {
    if (source.type !== "json") throw new Error("json_source_required");
    if (!("template" in source)) return null;
    if (
      source.template.id === "adp" &&
      source.url.includes("apply-custom-filters")
    )
      return null;
    const definition = this.templates.resolve(source.template);
    const listingRequest = reusableJsonRequestHook(
      definition.requestHook,
    )?.listingRequest;
    if (!listingRequest) return null;
    const request = await listingRequest(
      source,
      responseBody,
      responseHeaders,
      page,
      term,
    );
    if (!request)
      throw new Error(`${source.template.id}_configuration_invalid`);
    return request;
  }
  async decode(source: SourceConfiguration, body: string, page: number) {
    if (source.type !== "json") throw new Error("json_source_required");
    if ("template" in source)
      return decodeReusableJson(
        source,
        body,
        page,
        this.templates.resolve(source.template),
      );
    return extractJsonScriptEnvelope(source, body);
  }
}

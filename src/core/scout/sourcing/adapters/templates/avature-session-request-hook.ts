import type { ReusableJsonRequestHook, ReusableJsonTemplateSource } from "./types";
import { object } from "./support";

const pageSize = 12;

function cookieHeader(setCookie: string | undefined) {
  if (!setCookie) return "";
  return setCookie
    .split(/,\s*(?=[^;,=]+=[^;,]+)/)
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

type BootstrapConfiguration = {
  portalId: string;
  properties: Record<string, unknown>;
};

async function readBootstrap(body: string): Promise<BootstrapConfiguration> {
  let portalId = "";
  let properties: Record<string, unknown> | null = null;
  const rewriter = new HTMLRewriter();

  rewriter.on('meta[name="avature.portal.id"]', {
    element(element) {
      portalId = element.getAttribute("content") ?? "";
    },
  });
  rewriter.on('list[data-props][data-props*="ResultsAndCount"]', {
    element(element) {
      const value = element.getAttribute("data-props");
      if (!value) return;
      try {
        properties = object(JSON.parse(value));
      } catch {
        properties = null;
      }
    },
  });

  await rewriter.transform(new Response(body)).text();
  if (!portalId || !properties) throw new Error("avature_bootstrap_invalid");
  return { portalId, properties };
}

export class AvatureSessionRequestHook implements ReusableJsonRequestHook {
  request(source: ReusableJsonTemplateSource) {
    return { url: source.url, method: "GET" as const };
  }

  async listingRequest(
    source: ReusableJsonTemplateSource,
    configurationBody: string,
    configurationHeaders: Record<string, string>,
    pageNumber: number,
    term: string,
  ) {
    const bootstrap = await readBootstrap(configurationBody);
    const url = new URL(`/${bootstrap.portalId}/_portalList`, source.url);
    const properties = bootstrap.properties;
    const copiedProperties = [
      "uuid",
      "hasToIncludePaginationOptions",
      "allowListSorting",
      "fetchJobIdInPeopleLists",
      "listType",
      "firstColumnLinks",
      "additionalColumnLinks",
      "allowFilteringFromUrlParams",
      "layout",
      "links",
      "dynamicValueConfigs",
      "shouldAddBase64FileFields",
      "searchMode",
      "conditionalLinkConfig",
      "qtvc",
      "formId",
    ];
    for (const key of copiedProperties) {
      const value = properties[key];
      if (value === undefined) continue;
      url.searchParams.set(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
    url.searchParams.set("offset", String((pageNumber - 1) * pageSize));
    url.searchParams.set("filters", JSON.stringify({ search: term }));
    url.searchParams.set("sort", "");
    url.searchParams.set("sortDirection", "DESC");
    url.searchParams.set("recordsPerPage", String(pageSize));
    url.searchParams.set("token", "");
    url.searchParams.set("pageUrlParams", "{}");
    return {
      url: url.toString(),
      method: "GET" as const,
      headers: {
        referer: source.url,
        "x-requested-with": "XMLHttpRequest",
        cookie: cookieHeader(configurationHeaders["set-cookie"]),
      },
    };
  }

}

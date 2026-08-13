import type { SourceConfiguration } from "../contracts";
import { extractHtmlSelectors } from "../extractors/html-selectors";
import { planSourceRequest } from "../source-plan";
import type { SourceAdapter } from "./types";

export class HtmlSourceAdapter implements SourceAdapter {
  terms() {
    return [""];
  }
  request(
    source: SourceConfiguration,
    page: number,
    _term: string,
    nextPageUrl: string | null,
  ) {
    if (source.type !== "html") throw new Error("html_source_required");
    return nextPageUrl
      ? { url: nextPageUrl, method: "GET" as const }
      : page === 1
        ? { url: source.url, method: "GET" as const }
        : planSourceRequest(source, page);
  }
  async decode(source: SourceConfiguration, body: string, pageNumber: number) {
    if (source.type !== "html") throw new Error("html_source_required");
    return extractHtmlSelectors(source, body, pageNumber);
  }
}

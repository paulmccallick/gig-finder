import type { NormalizedPosition, SourceConfiguration } from "../contracts";
import { normalizeDescription } from "../descriptions";

type HtmlSource = Extract<SourceConfiguration, { type: "html" }>;
type Field = { selector?: string; attribute?: string };
type Listing = {
  title: string;
  url: string;
  location: string;
  id: string;
  description: string;
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const cleanAttribute = (value: string) =>
  clean(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const canonicalizeDetailUrl = (href: string, sourceUrl: string) => {
  const canonicalUrl = new URL(href, sourceUrl);
  const source = new URL(sourceUrl);
  if (
    source.protocol === "https:" &&
    canonicalUrl.protocol === "http:" &&
    canonicalUrl.hostname === source.hostname
  ) {
    canonicalUrl.protocol = "https:";
  }
  return canonicalUrl.toString();
};

export async function extractHtmlSelectors(
  source: HtmlSource,
  body: string,
  pageNumber: number,
) {
  if (
    !source.listingSelector ||
    !source.titleField ||
    !source.urlField ||
    !source.listingSurfaceSelector
  )
    throw new Error("html_selector_configuration_required");

  const listings: Listing[] = [];
  let activeListing = -1;
  let surfaceNodes = 0;
  let emptyStateNodes = 0;
  let nextPageUrl: string | null = null;
  const rewriter = new HTMLRewriter();

  rewriter.on(source.listingSurfaceSelector, {
    element() {
      surfaceNodes++;
    },
  });
  if (source.emptyStateSelector)
    rewriter.on(source.emptyStateSelector, {
      element() {
        emptyStateNodes++;
      },
    });
  rewriter.on(source.listingSelector, {
    element(element) {
      const index = listings.push({
        title: "",
        url: "",
        location: "",
        id: "",
        description: "",
      });
      activeListing = index - 1;
      element.onEndTag(() => {
        if (activeListing === index - 1) activeListing = -1;
      });
    },
  });

  const capture = (field: keyof Listing, configuration: Field) => {
    const selector = configuration.selector
      ? `${source.listingSelector} ${configuration.selector}`
      : source.listingSelector!;
    rewriter.on(selector, {
      element(element) {
        if (activeListing < 0) return;
        if (configuration.attribute)
          listings[activeListing]![field] += cleanAttribute(
            element.getAttribute(configuration.attribute) ?? "",
          );
      },
      text(text) {
        if (activeListing >= 0 && !configuration.attribute)
          listings[activeListing]![field] += text.text;
      },
    });
  };
  capture("title", source.titleField);
  capture("url", source.urlField);
  if (source.locationField) capture("location", source.locationField);
  if (source.idField) capture("id", source.idField);
  if (source.descriptionField)
    capture("description", source.descriptionField);
  if (source.nextPage)
    rewriter.on(source.nextPage.selector, {
      element(element) {
        const value = element.getAttribute(source.nextPage!.attribute);
        if (value) {
          const configuredUrl = source.nextPage!.urlTemplate?.replace(
            "{page}",
            String(pageNumber + 1),
          );
          nextPageUrl = new URL(
            configuredUrl ?? cleanAttribute(value),
            source.url,
          ).toString();
        }
      },
    });

  await rewriter.transform(new Response(body)).text();
  const positions: NormalizedPosition[] = [];
  let titleBearingNodes = 0;
  let urlBearingNodes = 0;
  for (const listing of listings) {
    const title = clean(listing.title);
    const href = clean(listing.url);
    if (title) titleBearingNodes++;
    if (href) urlBearingNodes++;
    if (!title || !href) continue;
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeDetailUrl(href, source.url);
    } catch {
      continue;
    }
    const description = normalizeDescription(listing.description);
    positions.push({
      sourceKey: source.key,
      externalId: clean(listing.id) || null,
      canonicalUrl,
      title,
      location: clean(listing.location) || null,
      description,
      provenance: {
        sourceKey: source.key,
        sourceUrl: source.url,
        description: description ? "listing" : "none",
        descriptionUrl: description ? null : canonicalUrl,
      },
    });
  }
  return {
    positions,
    surfaceVerified:
      surfaceNodes > 0 && (listings.length > 0 || emptyStateNodes > 0),
    sourceReportedTotal: null,
    recordsReceived: listings.length,
    titleBearingNodes,
    urlBearingNodes,
    hasNext: nextPageUrl !== null,
    nextPageUrl,
    diagnostics: [
      ...(titleBearingNodes < listings.length
        ? [
            {
              code: "listing_nodes_missing_title",
              category: "extraction" as const,
              count: listings.length - titleBearingNodes,
              message: "Listing nodes did not contain a configured title.",
            },
          ]
        : []),
      ...(urlBearingNodes < listings.length
        ? [
            {
              code: "listing_nodes_missing_url",
              category: "extraction" as const,
              count: listings.length - urlBearingNodes,
              message: "Listing nodes did not contain a configured detail URL.",
            },
          ]
        : []),
    ],
  };
}

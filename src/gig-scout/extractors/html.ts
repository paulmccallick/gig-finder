import type { NormalizedPosition, SourceConfiguration } from "../contracts";
import { normalizeDescription } from "../descriptions";

const stripMarkup = (value: string) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
function matches(pattern: string, value: string) {
  return [...value.matchAll(new RegExp(pattern, "gis"))];
}
function capture(pattern: string | undefined, value: string) {
  if (!pattern) return undefined;
  return new RegExp(pattern, "is").exec(value)?.[1];
}
export function extractHtml(
  source: Extract<SourceConfiguration, { type: "html" }>,
  body: string,
): { positions: NormalizedPosition[]; surfaceVerified: boolean } {
  const positions = matches(source.listingPattern, body).flatMap(
    (listing): NormalizedPosition[] => {
      const fragment = listing[1] ?? listing[0];
      const title = capture(source.titlePattern, fragment);
      const href = capture(source.urlPattern, fragment);
      if (!title || !href) return [];
      let canonicalUrl: string;
      try {
        canonicalUrl = new URL(href, source.url).toString();
      } catch {
        return [];
      }
      const id = capture(source.idPattern, fragment);
      const location = capture(source.locationPattern, fragment);
      const description = normalizeDescription(
        capture(source.descriptionPattern, fragment),
      );
      return [
        {
          sourceKey: source.key,
          externalId: id?.trim() || null,
          canonicalUrl,
          title: stripMarkup(title),
          location: location ? stripMarkup(location) : null,
          description,
          provenance: {
            sourceKey: source.key,
            sourceUrl: source.url,
            description: description ? "listing" : "none",
            descriptionUrl: description ? null : canonicalUrl,
          },
        },
      ];
    },
  );
  return {
    positions,
    surfaceVerified: new RegExp(source.expectedSurfacePattern, "is").test(body),
  };
}

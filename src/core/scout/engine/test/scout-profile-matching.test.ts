import { describe, expect, test } from "bun:test";
import { positionMatchesSearchProfile } from "../../sourcing/diagnostics";
import { normalizeLocations } from "../../sourcing/matching";

const position = (title: string, location: string | null, values: string[] = location ? [location] : []) => ({
  title,
  location,
  locations: normalizeLocations(values),
  workArrangement: null,
});

describe("Scout profile matching", () => {
  test("matches configured leadership variants on token boundaries", () => {
    const profile = {
      terms: ["Vice President"],
      titleVariants: [{ term: "Vice President", variants: ["VP"] }],
      locations: ["Remote"],
    };
    expect(positionMatchesSearchProfile(position("VP, Architecture", "2 Locations", ["Remote USA", "Remote Canada"]), profile)).toMatchObject({ title: true, location: true });
    expect(positionMatchesSearchProfile(position("Developer Platform Lead", "Remote"), profile).title).toBe(false);
  });

  test("normalizes remote intent without inferring it from a country", () => {
    const profile = { terms: [], locations: ["Remote"] };
    expect(positionMatchesSearchProfile(position("Director", "26 Locations", ["Hartford - Work at Home"]), profile).location).toBe(true);
    expect(positionMatchesSearchProfile(position("Director", "United States"), profile).location).toBe(false);
  });

  test("defers aggregate-only locations instead of creating a false negative", () => {
    const aggregate = position("Director", "26 Locations");
    expect(aggregate.locations).toEqual([]);
    expect(positionMatchesSearchProfile(aggregate, { terms: [], locations: ["Remote"] }).location).toBe(true);
  });
});

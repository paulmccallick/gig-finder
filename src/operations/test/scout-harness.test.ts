import { expect, test } from "bun:test";
import { crediblePosting, paginationEvidenceIsValid } from "../scout-harness";
const position = {
  company: "Synthetic Company",
  sourceKey: "official",
  externalId: "role-1",
  canonicalUrl: "https://careers.example.test/jobs/role-1",
  title: "Reliability Gardener",
  location: null,
  description: null,
  provenance: {
    sourceKey: "official",
    sourceUrl: "https://careers.example.test/jobs",
    description: "none" as const,
    descriptionUrl: null,
  },
};
test("posting semantics reject navigation placeholders and require matching detail content", () => {
  expect(
    crediblePosting(
      position,
      "<main>Reliability Gardener job description</main>",
    ),
  ).toBeTrue();
  expect(
    crediblePosting(
      { ...position, canonicalUrl: "https://careers.example.test/" },
      "Reliability Gardener",
    ),
  ).toBeFalse();
  expect(crediblePosting(position, "<nav>Home Careers</nav>")).toBeFalse();
});

test("pagination evidence accepts a validated retry after a transient failure", () => {
  expect(
    paginationEvidenceIsValid(
      [
        {
          stage: "listing_page_2",
          pagesValidated: 0,
          uniqueIdentities: 0,
        },
        {
          stage: "listing_page_2",
          pagesValidated: 1,
          uniqueIdentities: 20,
        },
      ],
      2,
    ),
  ).toBeTrue();
  expect(
    paginationEvidenceIsValid(
      [
        {
          stage: "listing_page_1",
          pagesValidated: 1,
          uniqueIdentities: 12,
        },
      ],
      2,
      "single-response",
    ),
  ).toBeTrue();
});

test("pagination evidence rejects a second page without unique identities", () => {
  expect(
    paginationEvidenceIsValid(
      [
        {
          stage: "listing_page_2",
          pagesValidated: 0,
          uniqueIdentities: 0,
        },
      ],
      2,
    ),
  ).toBeFalse();
});

test("pagination evidence requires proof when a source stops after one page", () => {
  expect(
    paginationEvidenceIsValid(
      [
        {
          stage: "listing_page_1",
          pagesValidated: 1,
          uniqueIdentities: 20,
        },
      ],
      2,
    ),
  ).toBeFalse();
  expect(
    paginationEvidenceIsValid(
      [
        {
          stage: "listing_page_1",
          pagesValidated: 1,
          uniqueIdentities: 12,
          sourceReportedTotal: 12,
          recordsReceived: 12,
        },
      ],
      2,
    ),
  ).toBeTrue();
});

test("pagination evidence rejects premature success after a later total resets", () => {
  expect(
    paginationEvidenceIsValid(
      [
        {
          stage: "listing_page_1",
          pagesValidated: 1,
          uniqueIdentities: 20,
          sourceReportedTotal: 100,
          recordsReceived: 20,
        },
        {
          stage: "listing_page_2",
          pagesValidated: 1,
          uniqueIdentities: 20,
          sourceReportedTotal: 0,
          recordsReceived: 20,
        },
      ],
      200,
    ),
  ).toBeFalse();
});

test("an empty source passes after a transient request retry succeeds", async () => {
  const { runScoutHarness } = await import("../scout-harness");
  let calls = 0;
  const result = await runScoutHarness(
    {
      version: 1,
      searchProfile: { terms: [], locations: [] },
      companies: [
        {
          id: "synthetic",
          name: "Synthetic",
          active: true,
          sources: [
            {
              key: "official",
              active: true,
              type: "json",
              url: "https://api.example.test/jobs",
              recordsPath: "jobs",
              totalPath: "total",
              fields: { id: "id", title: "title", url: "url" },
            },
          ],
        },
      ],
    },
    { maxPages: 200 },
    {
      http: {
        async request(input) {
          calls++;
          return {
            status: calls === 1 ? 503 : 200,
            url: input.url,
            headers: {},
            body: JSON.stringify({ total: 0, jobs: [] }),
          };
        },
      },
    },
  );
  expect(calls).toBe(2);
  expect(result.passed).toBeTrue();
});

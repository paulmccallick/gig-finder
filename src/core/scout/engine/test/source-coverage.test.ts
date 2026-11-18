import type { HttpResponse } from "../../sourcing/ports";
import { expect, test } from "bun:test";
import { scanCompany, type GigScoutHttpPort } from "..";
import { scoutTemplateCatalog } from "../../../../operations/scout-template-catalog";
import { AdpSessionRequestHook } from "../../sourcing/adapters/templates/adp-session-request-hook";
import { reusableJsonSourceSchema } from "../../sourcing/contracts";

const source = (id: string, version = 1) => ({
  key: "official",
  active: true,
  type: "json" as const,
  url: "https://careers.example.test/careers",
  template: { id, version },
  variables: id === "workday" ? { tenant: "example", site: "careers" } : {},
});
const scan = (sources: unknown[], http: GigScoutHttpPort) =>
  scanCompany(
    {
      companyId: "synthetic",
      companyName: "Synthetic",
      configurationVersionId: "v1",
      sources: sources as Parameters<typeof scanCompany>[0]["sources"],
      searchProfile: { terms: [], locations: [] },
    },
    { http, templates: scoutTemplateCatalog },
  );

for (const laterTotal of [0, undefined]) {
  test(`retains earlier Workday total when subsequent pages report ${laterTotal}`, async () => {
    const offsets: number[] = [];
    const result = await scan([source("workday", 3)], {
      async request(input) {
        const offset = Number(JSON.parse(input.body!).offset);
        offsets.push(offset);
        return {
          status: 200,
          url: input.url,
          headers: {},
          body: JSON.stringify({
            total: offset === 0 ? 45 : laterTotal,
            jobPostings: Array.from(
              { length: Math.min(20, 45 - offset) },
              (_, i) => ({
                title: `Gardener ${offset + i}`,
                externalPath: `/job/${offset + i}`,
                locationsText: "Remote",
              }),
            ),
          }),
        };
      },
    });
    expect(offsets).toEqual([0, 20, 40]);
    expect(result.positions).toHaveLength(45);
    expect(result.sources[0]!.status).toBe("succeeded_with_results");
  });
}

test("Jibe counts actual records instead of assumed page capacity", async () => {
  const pages: number[] = [];
  const result = await scan([source("jibe")], {
    async request(input) {
      const page = Number(new URL(input.url).searchParams.get("page"));
      pages.push(page);
      const start = (page - 1) * 10;
      return {
        status: 200,
        url: input.url,
        headers: {},
        body: JSON.stringify({
          total: 25,
          jobs: Array.from({ length: Math.min(10, 25 - start) }, (_, i) => ({
            data: { slug: String(start + i), title: `Gardener ${start + i}` },
          })),
        }),
      };
    },
  });
  expect(pages).toEqual([1, 2, 3]);
  expect(result.positions).toHaveLength(25);
});

test("missing records before the retained total are not successful exhaustion", async () => {
  const result = await scan([source("workday", 3)], {
    async request(input) {
      const offset = Number(JSON.parse(input.body!).offset);
      return {
        status: 200,
        url: input.url,
        headers: {},
        body: JSON.stringify({
          total: offset ? 0 : 40,
          jobPostings: offset
            ? []
            : Array.from({ length: 20 }, (_, i) => ({
                title: `Gardener ${i}`,
                externalPath: `/job/${i}`,
              })),
        }),
      };
    },
  });
  expect(result.sources[0]!.status).toBe("failed");
});

test("ADP followup requests advance the offset", () => {
  const configured = reusableJsonSourceSchema.parse(source("adp"));
  const request = new AdpSessionRequestHook().listingRequest(
    configured,
    JSON.stringify({
      myJobsToken: "synthetic",
      properties: { myadpUrl: "https://api.example.test" },
    }),
    {},
    3,
  )!;
  expect(new URL(request.url).searchParams.get("$skip")).toBe("200");
});

test("custom JSON decodes declared string envelopes and paginates offsets", async () => {
  const offsets: number[] = [];
  const result = await scan(
    [
      {
        key: "official",
        active: true,
        type: "json",
        method: "GET",
        url: "https://api.example.test/jobs",
        responseEncoding: "json-string",
        recordsPath: "records",
        totalPath: "count",
        pagination: {
          offsetParameter: "start",
          limitParameter: "size",
          pageSize: 2,
        },
        fields: { id: "id", title: "title", url: "url" },
      },
    ],
    {
      async request(input) {
        const url = new URL(input.url),
          offset = Number(url.searchParams.get("start"));
        offsets.push(offset);
        expect(url.searchParams.has("page")).toBeFalse();
        return {
          status: 200,
          url: input.url,
          headers: {},
          body: JSON.stringify(
            JSON.stringify({
              count: 3,
              records: Array.from(
                { length: Math.min(2, 3 - offset) },
                (_, i) => ({
                  id: String(offset + i),
                  title: `Gardener ${offset + i}`,
                  url: `/jobs/${offset + i}`,
                }),
              ),
            }),
          ),
        };
      },
    },
  );
  expect(offsets).toEqual([0, 2]);
  expect(result.positions).toHaveLength(3);
});

for (const blocked of [true, false]) {
  test(`classifies access challenges separately from extraction failures: ${blocked}`, async () => {
    let calls = 0;
    const result = await scan([source("avature")], {
      async request(input) {
        calls++;
        const headers: Record<string, string> = blocked
          ? { "x-amzn-waf-action": "challenge" }
          : {};
        return { status: 202, url: input.url, headers, body: "" };
      },
    });
    const failure = result.sources[0]!.attempts[0]!.failure!;
    expect(failure.code).toBe(
      blocked ? "access_blocked" : "source_attempt_failed",
    );
    expect(failure.message).toContain(
      blocked ? "HTTP 202" : "avature_bootstrap_invalid",
    );
    if (blocked) expect(calls).toBe(1);
  });
}

test("Oracle v3 reads nested totals and Phenom v2 builds a detail URL without applyUrl", async () => {
  const oracle = await scan([source("oracle-hcm", 3)], {
    async request(input) {
      return {
        status: 200,
        url: input.url,
        headers: {},
        body: JSON.stringify({
          items: [
            {
              TotalJobsCount: 1,
              requisitionList: [{ Id: "1", Title: "Gardener" }],
            },
          ],
        }),
      };
    },
  });
  expect(oracle.sources[0]!.attempts[0]!.sourceReportedTotal).toBe(1);
  const phenom = await scan(
    [
      {
        ...source("phenom", 2),
        url: "https://careers.example.test/us/en/search-results",
      },
    ],
    {
      async request(input) {
        return {
          status: 200,
          url: input.url,
          headers: {},
          body: `phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { totalHits: 1, data: { jobs: [{ jobId: "1", title: "Gardener", applyUrl: "" }] } } })};`,
        };
      },
    },
  );
  expect(phenom.positions[0]!.canonicalUrl).toBe(
    "https://careers.example.test/us/en/job/1",
  );
});

test("Oracle pagination passes the offset inside the finder", async () => {
  const offsets: number[] = [];
  const result = await scan([source("oracle-hcm", 3)], {
    async request(input) {
      const finder = new URL(input.url).searchParams.get("finder")!;
      const offset = Number(finder.match(/offset=(\d+)/)![1]);
      offsets.push(offset);
      return {
        status: 200,
        url: input.url,
        headers: {},
        body: JSON.stringify({
          items: [
            {
              TotalJobsCount: 26,
              requisitionList: Array.from(
                { length: offset ? 1 : 25 },
                (_, i) => ({
                  Id: String(offset + i),
                  Title: `Gardener ${offset + i}`,
                }),
              ),
            },
          ],
        }),
      };
    },
  });
  expect(offsets).toEqual([0, 25]);
  expect(result.positions).toHaveLength(26);
});

test("planned descriptions follow same-origin canonical redirects and reject cross-origin redirects", async () => {
  const { acquirePlannedDescription } =
    await import("../../sourcing/detail-descriptions");
  const plan = {
    request: {
      url: "https://careers.example.test/job/1",
      method: "GET" as const,
    },
    response: "json" as const,
    descriptionPath: "description",
    identity: { idPath: "id" },
    contentFormat: "html" as const,
    contentEncoding: "none" as const,
    strategyVersion: "synthetic-v1",
  };
  const calls: string[] = [];
  const result = await acquirePlannedDescription(
    plan,
    { id: "1", title: "Gardener" },
    {
      async request(input): Promise<HttpResponse> {
        calls.push(input.url);
        return input.url.endsWith("/job/1")
          ? {
              status: 302,
              url: input.url,
              headers: { location: "/job/gardener/1" },
              body: "",
            }
          : {
              status: 200,
              url: input.url,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: "1",
                description: "<p>Grow systems.</p>",
              }),
            };
      },
    },
  );
  expect(calls).toHaveLength(2);
  expect(result.markdown).toContain("Grow systems.");
  await expect(
    acquirePlannedDescription(
      plan,
      { id: "1", title: "Gardener" },
      {
        async request(input): Promise<HttpResponse> {
          return {
            status: 302,
            url: input.url,
            headers: { location: "https://other.example.test/job/1" },
            body: "",
          };
        },
      },
    ),
  ).rejects.toThrow("description_redirect_invalid");
});

test("offset pagination requires a total and rejects absent or malformed response totals", async () => {
  const { customJsonSourceSchema } = await import("../../sourcing/contracts");
  const custom = {
    key: "official",
    active: true,
    type: "json",
    url: "https://api.example.test/jobs",
    recordsPath: "jobs",
    fields: { id: "id", title: "title", url: "url" },
    pagination: {
      offsetParameter: "offset",
      limitParameter: "limit",
      pageSize: 2,
    },
  };
  expect(customJsonSourceSchema.safeParse(custom).success).toBeFalse();
  for (const total of [undefined, "unknown", -1]) {
    const result = await scan([{ ...custom, totalPath: "total" }], {
      async request(input) {
        return {
          status: 200,
          url: input.url,
          headers: {},
          body: JSON.stringify({
            total,
            jobs: [{ id: "1", title: "Gardener", url: "/jobs/1" }],
          }),
        };
      },
    });
    expect(result.sources[0]!.status).toBe("failed");
    expect(result.sources[0]!.attempts[0]!.failure!.message).toContain(
      "source_reported_total_invalid",
    );
  }
});

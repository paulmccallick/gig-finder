import { expect, test } from "bun:test";
import { scanCompany, type GigScoutHttpPort } from "..";

const source = {
  key: "official",
  type: "html" as const,
  url: "https://careers.example.test/jobs",
  active: true,
  listingSelector: "main .posting",
  titleField: { selector: ".title" },
  urlField: { selector: "a.detail", attribute: "href" },
  locationField: { selector: ".location" },
  listingSurfaceSelector: "main.jobs",
  emptyStateSelector: "main.jobs .empty",
  nextPage: { selector: "main.jobs a.next", attribute: "href" },
};

test("same-host HTTP detail links inherit HTTPS from the listing surface", async () => {
  const result = await scanCompany(
    {
      companyId: "synthetic-company",
      configurationVersionId: "synthetic-config",
      sources: [
        {
          ...source,
          listingSelector: "main .posting a.detail",
          titleField: {},
          urlField: { attribute: "href" },
          listingSurfaceSelector: "main",
        },
      ],
    },
    {
      http: {
        async request(input) {
          return {
            status: 200,
            url: input.url,
            headers: {},
            body: `<main><article class="posting"><a class="detail" href="http://careers.example.test/jobs/platform-engineer">Platform Engineer</a></article></main>`,
          };
        },
      },
    },
  );

  expect(result.positions[0]?.canonicalUrl).toBe(
    "https://careers.example.test/jobs/platform-engineer",
  );
  expect(result.sources[0]?.status).toBe("succeeded_with_results");
});

test("selector HTML extraction avoids navigation links and validates two pages", async () => {
  const requests: string[] = [];
  const http: GigScoutHttpPort = {
    async request(input) {
      requests.push(input.url);
      return {
        status: 200,
        url: input.url,
        headers: {},
        body:
          requests.length === 1
            ? `<nav><a href="/about">About</a></nav><main class="jobs"><article class="posting"><h2 class="title"><span>Garden</span> Engineer</h2><a class="detail" href="/jobs/one">Open</a><span class="location">Remote</span></article><a class="next" href="/jobs?page=2">Next</a></main>`
            : `<main class="jobs"><article class="posting"><h2 class="title">Orchard Engineer</h2><a class="detail" href="/jobs/two">Open</a></article></main>`,
      };
    },
  };
  const result = await scanCompany(
    {
      companyId: "synthetic-company",
      configurationVersionId: "synthetic-config",
      sources: [source],
    },
    { http },
  );

  expect(requests).toEqual([
    "https://careers.example.test/jobs",
    "https://careers.example.test/jobs?page=2",
  ]);
  expect(result.sources[0]?.status).toBe("succeeded_with_results");
  expect(result.positions.map((position) => position.title)).toEqual([
    "Garden Engineer",
    "Orchard Engineer",
  ]);
});

test("selector HTML extraction supports an explicit pagination URL template", async () => {
  const requests: string[] = [];
  const result = await scanCompany(
    {
      companyId: "synthetic-company",
      configurationVersionId: "synthetic-config",
      sources: [
        {
          ...source,
          nextPage: {
            ...source.nextPage,
            urlTemplate: "https://careers.example.test/openings?p={page}",
          },
        },
      ],
    },
    {
      http: {
        async request(input) {
          requests.push(input.url);
          return {
            status: 200,
            url: input.url,
            headers: {},
            body:
              requests.length === 1
                ? `<main class="jobs"><article class="posting"><h2 class="title">Platform Engineer</h2><a class="detail" href="/jobs/one">Open</a></article><a class="next" href="/broken-next-link">Next</a></main>`
                : `<main class="jobs"><article class="posting"><h2 class="title">Data Engineer</h2><a class="detail" href="/jobs/two">Open</a></article></main>`,
          };
        },
      },
    },
  );

  expect(requests).toEqual([
    "https://careers.example.test/jobs",
    "https://careers.example.test/openings?p=2",
  ]);
  expect(result.sources[0]?.status).toBe("succeeded_with_results");
});

test("selector HTML extraction requires explicit empty-state evidence", async () => {
  const scan = async (body: string) =>
    scanCompany(
      {
        companyId: "synthetic-company",
        configurationVersionId: "synthetic-config",
        sources: [source],
      },
      {
        http: {
          async request(input) {
            return { status: 200, url: input.url, headers: {}, body };
          },
        },
      },
    );

  expect((await scan(`<main class="jobs"><div></div></main>`)).sources[0]?.status).toBe(
    "suspicious_empty",
  );
  expect(
    (await scan(`<main class="jobs"><p class="empty">No openings</p></main>`))
      .sources[0]?.status,
  ).toBe("succeeded_empty_verified");
});

test("selector HTML extraction reports missing title and URL nodes", async () => {
  const result = await scanCompany(
    {
      companyId: "synthetic-company",
      configurationVersionId: "synthetic-config",
      sources: [source],
    },
    {
      http: {
        async request(input) {
          return {
            status: 200,
            url: input.url,
            headers: {},
            body: `<main class="jobs"><article class="posting"><div></div></article></main>`,
          };
        },
      },
    },
  );

  expect(result.sources[0]?.status).toBe("failed");
  expect(result.sources[0]?.attempts[0]?.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "listing_nodes_missing_title" }),
      expect.objectContaining({ code: "listing_nodes_missing_url" }),
    ]),
  );
});

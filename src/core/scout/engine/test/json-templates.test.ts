import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scanCompany as scanCompanyCore, type GigScoutHttpPort } from "..";
import { scoutTemplateCatalog } from "../../../../operations/scout-template-catalog";
import { customJsonSourceSchema, reusableJsonSourceSchema } from "../../sourcing/contracts";
import {
  createTemplateCatalog,
  reusableJsonDefinitionSchema,
  validateTemplateSourceInputs,
} from "../../sourcing/adapters/templates/definitions";
import { reusableJsonRequestHook } from "../../sourcing/adapters/templates/registry";
const fixtures = {
  greenhouse: {
    url: "https://boards.greenhouse.io/example-labs",
    body: {
      jobs: [
        {
          id: 101,
          title: "Reliability Gardener",
          absolute_url: "https://boards.greenhouse.io/example-labs/jobs/101",
          location: { name: "Remote" },
          content: "<p>Grow systems.</p>",
        },
      ],
    },
  },
  lever: {
    url: "https://jobs.lever.co/example-labs",
    body: [
      {
        id: "role-1",
        text: "Reliability Gardener",
        hostedUrl: "https://jobs.lever.co/example-labs/role-1",
        categories: { location: "Remote" },
        description: "<p>Grow systems.</p>",
      },
    ],
  },
  smartrecruiters: {
    url: "https://careers.smartrecruiters.com/ExampleLabs",
    body: {
      totalFound: 1,
      content: [
        {
          id: "role-1",
          name: "Reliability Gardener",
          postingUrl: "https://jobs.smartrecruiters.com/ExampleLabs/role-1",
          location: { fullLocation: "Remote" },
          jobAd: {
            sections: { jobDescription: { text: "<p>Grow systems.</p>" } },
          },
        },
      ],
    },
  },
  ashby: {
    url: "https://jobs.ashbyhq.com/example-labs",
    body: {
      jobs: [
        {
          id: "role-1",
          title: "Reliability Gardener",
          jobUrl: "https://jobs.ashbyhq.com/example-labs/role-1",
          location: "Remote",
          descriptionHtml: "<p>Grow systems.</p>",
        },
      ],
    },
  },
  workday: {
    url: "https://example.wd1.myworkdayjobs.com/en-US/careers",
    body: {
      total: 1,
      jobPostings: [
        {
          title: "Reliability Gardener",
          externalPath: "/job/role-1",
          bulletFields: ["Remote"],
          locationsText: "Remote",
        },
      ],
    },
  },
  "oracle-hcm": {
    url: "https://hcm.example.test/hcmUI/CandidateExperience/en/sites/CX_1",
    body: {
      count: 1,
      items: [
        {
          requisitionList: [
            {
              Id: "role-1",
              Title: "Reliability Gardener",
              ExternalCareerSiteURL: "https://hcm.example.test/jobs/role-1",
              PrimaryLocation: "Remote",
              ShortDescriptionStr: "Grow systems.",
            },
          ],
        },
      ],
    },
  },
  adp: {
    url: "https://myjobs.adp.com/example-labs/cx",
    body: {
      totalCount: 1,
      jobRequisitions: [
        {
          reqId: "role-1",
          publishedJobTitle: "Reliability Gardener",
          jobUrl: "https://myjobs.adp.com/example-labs/jobs/role-1",
          jobDescription: "Grow systems.",
        },
      ],
    },
  },
  eightfold: {
    url: "https://talent.example.test/careers?domain=example.test",
    body: {
      status: 200,
      data: {
        total: 1,
        positions: [
          {
            id: "role-1",
            name: "Reliability Gardener",
            positionUrl: "/careers/role-1",
            standardizedLocations: ["Remote"],
          },
        ],
      },
    },
  },
  jibe: {
    url: "https://careers.example.test/search",
    body: {
      total: 1,
      jobs: [
        {
          data: {
            slug: "role-1",
            language: "en-us",
            title: "Reliability Gardener",
            city: "Remote",
            description: "Grow systems.",
          },
        },
      ],
    },
  },
  "successfactors-rmk": {
    url: "https://careers.example.test/services/recruiting/v1/jobs?locale=en_US",
    body: {
      totalResults: 1,
      jobSearchResult: [
        {
          response: {
            id: "role-1",
            title: "Reliability Gardener",
            url: "/job/role-1",
            location: "Remote",
          },
        },
      ],
    },
  },
  gem: {
    url: "https://jobs.gem.com/example-labs",
    body: {
      data: {
        oatsExternalJobPostings: {
          jobPostings: [
            {
              id: "role-1",
              extId: "role-1",
              title: "Reliability Gardener",
              descriptionHtml: "Grow systems.",
              locations: [{ name: "Remote", isRemote: true }],
            },
          ],
        },
      },
    },
  },
  icims: {
    url: "https://careers.example.test/search/jobs",
    body: {
      total: 1,
      jobs: [
        {
          id: "role-1",
          title: "Reliability Gardener",
          url: "https://careers.example.test/jobs/role-1",
          location: "Remote",
          description: "Grow systems.",
        },
      ],
    },
  },
  phenom: {
    url: "https://careers.example.test/search-results",
    body: {
      eagerLoadRefineSearch: {
        hits: 1,
        totalHits: 1,
        data: {
          jobs: [
            {
              jobSeqNo: "role-1",
              title: "Reliability Gardener",
              applyUrl: "https://careers.example.test/apply/role-1",
              location: "Remote",
              descriptionTeaser: "Grow systems.",
            },
          ],
        },
      },
    },
  },
  avature: {
    url: "https://jobs.example.test/en_US/careers/SearchJobs",
    body: {
      results: [
        {
          id: "role-1",
          fields: {
            name: { stringValue: "Reliability Gardener" },
            description: {
              fieldType: "ParagraphWithFormat",
              stringValue: "Grow systems.",
            },
          },
        },
      ],
      links: [
        {
          detailPage: "https://jobs.example.test/en_US/careers/JobDetail?jobId=role-1",
        },
      ],
      total: "1",
    },
  },
  jobsyn: {
    url: "https://search.example.test/api/search?listing_origin=https%3A%2F%2Fcareers.example.test",
    body: {
      jobs: [
        {
          guid: "role-1",
          title_exact: "Reliability Gardener",
          title_slug: "reliability-gardener",
          location_exact: "Remote, USA",
          description: "Grow systems.",
        },
      ],
      pagination: { total: 1 },
    },
  },
} satisfies Record<string, { url: string; body: unknown }>;
type TemplateId = keyof typeof fixtures;
const scanCompany: typeof scanCompanyCore = (request, dependencies) =>
  scanCompanyCore(request, {
    ...dependencies,
    templates: scoutTemplateCatalog,
  });
describe("reusable JSON templates", () => {
  test("every reusable template has a validated declarative JSON definition", () => {
    for (const templateId of Object.keys(fixtures) as TemplateId[])
      expect(
        reusableJsonDefinitionSchema.safeParse(
          scoutTemplateCatalog.resolve({ id: templateId, version: 1 }),
        ).success,
      ).toBe(true);
  });
  test("company configuration resolves an exact template version", () => {
    const source = {
      key: "official",
      type: "json",
      url: "https://example.wd1.myworkdayjobs.com/en-US/External",
      template: { id: "workday", version: 1 },
      variables: { tenant: "example", site: "External" },
    };
    expect(reusableJsonSourceSchema.safeParse(source).success).toBe(true);
    expect(scoutTemplateCatalog.resolve({ id: "workday", version: 1 }).detailDescription).toBeUndefined();
    expect(scoutTemplateCatalog.resolve({ id: "workday", version: 2 }).detailDescription).toBeDefined();
    expect(scoutTemplateCatalog.resolve({ id: "workday", version: 3 }).detailDescription?.locationPaths).toEqual([
      "jobPostingInfo.location",
      "jobPostingInfo.additionalLocations.*",
    ]);
    expect(() => scoutTemplateCatalog.resolve({ id: "workday", version: 4 })).toThrow("unknown_scout_template");
  });
  test("description semantics default for existing JSON configurations and reject invalid entity decoding", () => {
    const source = customJsonSourceSchema.parse({
      key: "official",
      type: "json",
      url: "https://careers.example.test/jobs",
      recordsPath: "jobs",
      fields: {
        title: "title",
        url: "url",
        description: { path: "description" },
      },
    });
    expect(source.fields.description).toMatchObject({
      path: "description",
      contentFormat: "auto",
      contentEncoding: "none",
    });
    expect(customJsonSourceSchema.safeParse({
      ...source,
      fields: {
        ...source.fields,
        description: {
          path: "description",
          contentFormat: "plain-text",
          contentEncoding: "html-entities",
        },
      },
    }).success).toBe(false);
  });
  test("Greenhouse v3 decodes configured listing HTML without changing prior template defaults", async () => {
    const templateRoot = path.resolve(
      import.meta.dir,
      "../../../../../config/scout/templates",
    );
    expect(createHash("sha256").update(
      readFileSync(path.join(templateRoot, "greenhouse.v1.json")),
    ).digest("hex")).toBe(
      "ce88eacad9bbe91e3290fe742394945c9e16cf35466bf04039467448dd633efb",
    );
    expect(createHash("sha256").update(
      readFileSync(path.join(templateRoot, "greenhouse.v2.json")),
    ).digest("hex")).toBe(
      "7224940e28c77f6dd51362b473ad140628448b23b684aa76779e9bfa1a677456",
    );
    for (const version of [1, 2]) {
      const definition = scoutTemplateCatalog.resolve({ id: "greenhouse", version });
      expect(definition.fields.description).toMatchObject({
        contentFormat: "auto",
        contentEncoding: "none",
      });
      if (definition.detailDescription)
        expect(definition.detailDescription).toMatchObject({
          contentFormat: "auto",
          contentEncoding: "none",
        });
    }
    const definition = scoutTemplateCatalog.resolve({ id: "greenhouse", version: 3 });
    expect(definition.fields.description).toMatchObject({
      contentFormat: "html",
      contentEncoding: "html-entities",
    });
    expect(definition.detailDescription).toMatchObject({
      contentFormat: "html",
      contentEncoding: "html-entities",
    });
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [{
          key: "official",
          type: "json",
          template: { id: "greenhouse", version: 3 },
          url: "https://boards.greenhouse.io/example-labs",
          active: true,
        }],
      },
      {
        http: {
          async request(input) {
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({ jobs: [{
                id: 101,
                title: "Director of Reliability",
                absolute_url: "https://boards.greenhouse.io/example-labs/jobs/101",
                location: { name: "Remote" },
                content: "&amp;lt;p&amp;gt;Scope: &amp;lt;a href=&amp;quot;https://example.test/team&amp;quot; data-id=&amp;quot;ignored&amp;quot;&amp;gt;Own delivery&amp;lt;/a&amp;gt;.&amp;lt;/p&amp;gt;&amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;Lead teams.&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;",
              }] }),
            };
          },
        },
      },
    );
    expect(result.positions[0]?.description).toContain("Lead teams.");
    expect(result.positions[0]?.description).toContain("[Own delivery](https://example.test/team)");
    expect(result.positions[0]?.description).not.toContain("&lt;li");
  });
  test("template configuration owns required variables and allowed overrides", () => {
    const source = {
      key: "official",
      type: "json",
      url: "https://example.wd1.myworkdayjobs.com/en-US/External",
      template: { id: "workday", version: 1 },
      variables: { tenant: "example" },
    };
    expect(() =>
      validateTemplateSourceInputs(
        source.template,
        source.variables,
        {},
        scoutTemplateCatalog,
      ),
    ).toThrow("workday_variable_required:site");
    expect(() =>
      validateTemplateSourceInputs(
        source.template,
        { tenant: "example", site: "External" },
        { arbitrary: "value" },
        scoutTemplateCatalog,
      ),
    ).toThrow("workday_override_not_allowed:arbitrary");
  });
  test("catalog rejects duplicate template versions and non-HR artifacts", () => {
    const workday = scoutTemplateCatalog.resolve({ id: "workday", version: 1 });
    expect(() => createTemplateCatalog([workday, workday])).toThrow(
      "duplicate_scout_template",
    );
    expect(() =>
      createTemplateCatalog([{ ...workday, kind: "company" }]),
    ).toThrow();
  });
  test("ordinary template requests are declarative and only procedural mechanics use hooks", () => {
    const procedural = new Set<TemplateId>([
      "adp",
      "avature",
    ]);
    for (const templateId of Object.keys(fixtures) as TemplateId[]) {
      const definition = scoutTemplateCatalog.resolve({
        id: templateId,
        version: 1,
      });
      expect(Boolean(definition.request)).toBe(!procedural.has(templateId));
      expect(Boolean(reusableJsonRequestHook(definition.requestHook))).toBe(
        procedural.has(templateId),
      );
    }
  });
  test("one Jibe template serves multiple tenants with a validated override", async () => {
    const requested: string[] = [];
    const scan = (company: string, location?: string) =>
      scanCompany(
        {
          companyId: company,
          configurationVersionId: `config-${company}`,
          sources: [
            {
              key: "official",
              type: "json",
              template: { id: "jibe", version: 1 },
              url: `https://careers.${company}.example.test/jobs`,
              variables: { company },
              overrides: location ? { location } : {},
              active: true,
            },
          ],
          searchProfile: { terms: ["synthetic"], locations: [] },
        },
        {
          http: {
            async request(input) {
              requested.push(input.url);
              return {
                status: 200,
                url: input.url,
                headers: {},
                body: JSON.stringify(fixtures.jibe.body),
              };
            },
          },
        },
      );
    await scan("alpha");
    await scan("beta", "Synthetic Region");
    expect(requested[0]).toContain("company=alpha");
    expect(requested[0]).not.toContain("Synthetic+Region");
    expect(requested[1]).toContain("company=beta");
    expect(requested[1]).toContain("location=Synthetic+Region");
  });
  for (const [templateId, fixture] of Object.entries(fixtures) as Array<
    [TemplateId, (typeof fixtures)[TemplateId]]
  >)
    test(`${templateId} plans and normalizes its official API`, async () => {
      let requested = "",
        calls = 0;
      const http: GigScoutHttpPort = {
        async request(input) {
          requested = input.url;
          calls++;
          return {
            status: 200,
            url: input.url,
            headers: {},
            body:
              templateId === "adp" && calls === 1
                ? JSON.stringify({
                    myJobsToken: "synthetic-token",
                    properties: { myadpUrl: "https://my.adp.example.test" },
                  })
                : templateId === "avature" && calls === 1
                  ? `<meta name="avature.portal.id" content="13">
                     <list data-props='${JSON.stringify({
                       uuid: "synthetic-list",
                       listType: "JobList",
                       searchMode: "ResultsAndCount",
                       qtvc: "synthetic-token",
                     })}'></list>`
                : templateId === "phenom"
                  ? `var phApp = {}; phApp.ddo = ${JSON.stringify(fixture.body)};`
                  : JSON.stringify(fixture.body),
          };
        },
      };
      const result = await scanCompany(
        {
          companyId: "company-1",
          configurationVersionId: "config-1",
          sources: [
            {
              key: "official",
              type: "json",
              template: { id: templateId, version: 1 },
              url: fixture.url,
              active: true,
              ...(templateId === "workday"
                ? { variables: { tenant: "example", site: "External" } }
                : {}),
            },
          ],
        },
        { http },
      );
      expect(requested).toStartWith("https://");
      expect(result.sources[0]?.status).toBe("succeeded_with_results");
      expect(result.positions[0]?.title).toBe("Reliability Gardener");
      expect(result.positions[0]?.canonicalUrl).toStartWith("https://");
      if (templateId === "oracle-hcm")
        expect(result.positions[0]?.canonicalUrl).toBe(
          "https://hcm.example.test/hcmUI/CandidateExperience/en/sites/CX_1/job/role-1",
        );
      if (templateId === "adp" || templateId === "avature")
        expect(result.sources[0]?.attempts[0]).toMatchObject({
          requestCount: 2,
          responseCount: 2,
        });
    });
  for (const [templateId, fixture] of Object.entries(fixtures) as Array<
    [TemplateId, (typeof fixtures)[TemplateId]]
  >)
    test(`${templateId} treats a changed response surface as suspicious`, async () => {
      const http: GigScoutHttpPort = {
        async request(input) {
          return { status: 200, url: input.url, headers: {}, body: "{}" };
        },
      };
      const result = await scanCompany(
        {
          companyId: "company-1",
          configurationVersionId: "config-1",
          sources: [
            {
              key: "official",
              type: "json",
              template: { id: templateId, version: 1 },
              url: fixture.url,
              active: true,
              ...(templateId === "workday"
                ? { variables: { tenant: "example", site: "External" } }
                : {}),
            },
          ],
        },
        { http },
      );
      expect(result.sources[0]?.status).toBe(
        templateId === "adp" || templateId === "avature"
          ? "failed"
          : "suspicious_empty",
      );
    });
  test("Workday preserves public and API detail identities", async () => {
    const fixture = fixtures.workday;
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "workday", version: 1 },
            url: "https://example.wd1.myworkdayjobs.com/en-US/External",
            active: true,
            variables: { tenant: "example", site: "External" },
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
              body: JSON.stringify(fixture.body),
            };
          },
        },
      },
    );
    expect(result.positions[0]?.canonicalUrl).toBe(
      "https://example.wd1.myworkdayjobs.com/External/job/role-1",
    );
    expect(result.positions[0]?.externalId).toBe("/job/role-1");
    expect(result.positions[0]?.provenance.descriptionUrl).toBe(
      "https://example.wd1.myworkdayjobs.com/wday/cxs/example/External/job/role-1",
    );
  });
  test.each([
    {
      name: "J.D. Power",
      title: "VP, Architecture",
      display: "2 Locations",
      locations: ["Remote USA", "Remote Canada"],
      profile: {
        terms: ["Vice President"],
        titleVariants: [{ term: "Vice President", variants: ["VP"] }],
        locations: ["Remote"],
      },
    },
    {
      name: "CVS Health",
      title: "Director, Synthetic Systems",
      display: "26 Locations",
      locations: ["Hartford, CT - Work at Home", "Seattle, WA - Work at Home"],
      profile: { terms: ["Director"], locations: ["Remote"] },
    },
  ])("Workday enriches aggregate locations before filtering for $name", async ({ title, display, locations, profile }) => {
    const result = await scanCompanyCore(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        searchProfile: {
          terms: [...profile.terms],
          locations: [...profile.locations],
          ...(profile.titleVariants
            ? { titleVariants: profile.titleVariants.map(({ term, variants }) => ({ term, variants: [...variants] })) }
            : {}),
        },
        sources: [{
          key: "official",
          type: "json",
          template: { id: "workday", version: 3 },
          url: "https://example.wd1.myworkdayjobs.com/en-US/External",
          active: true,
          variables: { tenant: "example", site: "External" },
        }],
      },
      {
        templates: scoutTemplateCatalog,
        http: {
          async request(input) {
            if (input.method === "GET") return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                jobPostingInfo: {
                  title,
                  location: locations[0],
                  additionalLocations: locations.slice(1),
                  jobDescription: "Synthetic description",
                },
              }),
            };
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                total: 1,
                jobPostings: [{ title, externalPath: "/job/role-1", locationsText: display }],
              }),
            };
          },
        },
      },
    );
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({
      location: display,
      locations: locations.map((label) => ({ label, workArrangement: "remote" })),
      workArrangement: "remote",
    });
    expect(result.sources[0]?.attempts[0]?.filterDecisions?.[0]).toMatchObject({
      titleMatched: true,
      locationMatched: true,
      normalizedLocations: locations.map((value) => value.toLocaleLowerCase()),
      workArrangements: ["remote"],
    });
  });
  test("reusable templates preserve complete listing location arrays", async () => {
    const template = reusableJsonDefinitionSchema.parse({
      kind: "hr-system",
      version: 1,
      id: "synthetic-location-array",
      inputs: { variables: [], overrides: [] },
      recordsPaths: ["jobs"],
      totalPaths: ["total"],
      pageSize: 20,
      exhaustion: { mode: "reported-total" },
      request: {
        method: "GET",
        endpoint: { mode: "configured", clearQuery: false, removeQuery: [] },
        query: {},
        headers: {},
      },
      fields: {
        id: { paths: ["id"] },
        title: { paths: ["title"] },
        url: { paths: ["url"] },
        location: { paths: ["displayLocation"] },
        locations: { paths: ["locations.*"] },
      },
    });
    const result = await scanCompanyCore(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        searchProfile: { terms: ["Vice President"], locations: ["Remote"] },
        sources: [{
          key: "official",
          type: "json",
          template: { id: template.id, version: template.version },
          url: "https://careers.example.test/jobs",
          active: true,
          variables: {},
        }],
      },
      {
        templates: createTemplateCatalog([template]),
        http: {
          async request(input) {
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                total: 1,
                jobs: [{
                  id: "role-1",
                  title: "Vice President, Architecture",
                  url: "/jobs/role-1",
                  displayLocation: "2 Locations",
                  locations: ["Remote USA", "Remote Canada"],
                }],
              }),
            };
          },
        },
      },
    );
    expect(result.positions[0]?.locations?.map(({ label }) => label)).toEqual([
      "Remote USA",
      "Remote Canada",
    ]);
  });

  test.each([
    { name: "detail HTTP failure", maxRequests: 10 },
    { name: "request budget exhaustion", maxRequests: 1 },
  ])("Workday defers aggregate filtering after $name", async ({ maxRequests }) => {
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        searchProfile: { terms: ["Director"], locations: ["Remote"] },
        sources: [{
          key: "official",
          type: "json",
          template: { id: "workday", version: 3 },
          url: "https://example.wd1.myworkdayjobs.com/en-US/External",
          active: true,
          variables: { tenant: "example", site: "External" },
        }],
      },
      {
        templates: scoutTemplateCatalog,
        policy: { maxRequests },
        http: {
          async request(input) {
            if (input.method === "GET")
              return { status: 503, url: input.url, headers: {}, body: "" };
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                total: 1,
                jobPostings: [{
                  title: "Director, Architecture",
                  externalPath: "/job/role-1",
                  locationsText: "26 Locations",
                }],
              }),
            };
          },
        },
      },
    );
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({ location: "26 Locations", locations: [] });
    expect(result.sources[0]?.attempts[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: expect.stringContaining("location_enrichment_") }),
    );
  });
  test("search terms each start at page one and paginate independently", async () => {
    const requests: string[] = [];
    const bodies: string[] = [];
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "workday", version: 1 },
            url: "https://example.wd1.myworkdayjobs.com/en-US/External",
            active: true,
            variables: { tenant: "example", site: "External" },
          },
        ],
        searchProfile: { terms: ["garden", "orchard"], locations: [] },
      },
      {
        http: {
          async request(input) {
            requests.push(input.url);
            bodies.push(input.body ?? "");
            const body = JSON.parse(input.body ?? "{}") as {
              offset: number;
              searchText: string;
            };
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                total: body.offset === 0 ? 21 : 21,
                jobPostings:
                  body.offset === 0
                    ? Array.from({ length: 20 }, (_, index) => ({
                        title: `${body.searchText}-${index}`,
                        externalPath: `/job/${body.searchText}-${index}`,
                      }))
                    : [
                        {
                          title: `${body.searchText}-20`,
                          externalPath: `/job/${body.searchText}-20`,
                        },
                      ],
              }),
            };
          },
        },
      },
    );
    expect(requests).toHaveLength(4);
    expect(bodies.map((value) => JSON.parse(value))).toEqual([
      { appliedFacets: {}, limit: 20, offset: 0, searchText: "garden" },
      { appliedFacets: {}, limit: 20, offset: 20, searchText: "garden" },
      { appliedFacets: {}, limit: 20, offset: 0, searchText: "orchard" },
      { appliedFacets: {}, limit: 20, offset: 20, searchText: "orchard" },
    ]);
    expect(result.positions).toHaveLength(42);
  });
  test("pagination continues beyond three pages until the reported total is reconciled", async () => {
    const offsets: number[] = [];
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "workday", version: 1 },
            url: fixtures.workday.url,
            active: true,
            variables: { tenant: "example", site: "External" },
          },
        ],
      },
      {
        http: {
          async request(input) {
            const offset = Number(
              (JSON.parse(input.body ?? "{}") as { offset?: number }).offset ?? 0,
            );
            offsets.push(offset);
            const count = offset < 60 ? 20 : 1;
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                total: 61,
                jobPostings: Array.from({ length: count }, (_, index) => ({
                  title: `Synthetic Role ${offset + index}`,
                  externalPath: `/job/role-${offset + index}`,
                })),
              }),
            };
          },
        },
      },
    );
    expect(offsets).toEqual([0, 20, 40, 60]);
    expect(result.sources[0]?.status).toBe("succeeded_with_results");
    expect(result.positions).toHaveLength(61);
  });
  test("a runtime ceiling before proven exhaustion produces an explicit partial outcome", async () => {
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "workday", version: 1 },
            url: fixtures.workday.url,
            active: true,
            variables: { tenant: "example", site: "External" },
          },
        ],
      },
      {
        policy: { maxPages: 2 },
        http: {
          async request(input) {
            const offset = Number(
              (JSON.parse(input.body ?? "{}") as { offset?: number }).offset ?? 0,
            );
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                total: 61,
                jobPostings: Array.from({ length: 20 }, (_, index) => ({
                  title: `Synthetic Role ${offset + index}`,
                  externalPath: `/job/role-${offset + index}`,
                })),
              }),
            };
          },
        },
      },
    );
    expect(result.sources[0]?.status).toBe("partial");
    expect(result.sources[0]?.attempts.at(-1)?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "source_limit_reached" }),
    );
  });
  test("SuccessFactors RMK uses its POST payload and required referer", async () => {
    let request: Parameters<GigScoutHttpPort["request"]>[0] | undefined;
    await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "successfactors-rmk", version: 1 },
            url: fixtures["successfactors-rmk"].url,
            active: true,
          },
        ],
        searchProfile: { terms: ["gardener"], locations: [] },
      },
      {
        http: {
          async request(input) {
            request = input;
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify(fixtures["successfactors-rmk"].body),
            };
          },
        },
      },
    );
    expect(request?.method).toBe("POST");
    expect(request?.headers?.referer).toContain("q=gardener");
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      keywords: "gardener",
      pageNumber: 0,
    });
  });
  test("ADP discovers the private listing API from the public career-site configuration", async () => {
    const requests: Array<Parameters<GigScoutHttpPort["request"]>[0]> = [];
    await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "adp", version: 1 },
            url: fixtures.adp.url,
            active: true,
          },
        ],
      },
      {
        http: {
          async request(input) {
            requests.push(input);
            return {
              status: 200,
              url: input.url,
              headers: {},
              body:
                requests.length === 1
                  ? JSON.stringify({
                      myJobsToken: "synthetic-token",
                      properties: { myadpUrl: "https://my.adp.example.test" },
                    })
                  : JSON.stringify(fixtures.adp.body),
            };
          },
        },
      },
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain("apply-custom-filters");
    expect(requests[1]?.headers).toMatchObject({
      myjobstoken: "synthetic-token",
      rolecode: "manager",
    });
  });
  test("reported records that cannot be normalized fail reconciliation instead of becoming verified empty", async () => {
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "workday", version: 1 },
            url: fixtures.workday.url,
            active: true,
            variables: { tenant: "example", site: "External" },
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
              body: JSON.stringify({
                total: 200,
                jobPostings: Array.from({ length: 200 }, () => ({
                  empty: "record",
                })),
              }),
            };
          },
        },
      },
    );
    expect(result.sources[0]?.status).toBe("failed");
    expect(result.sources[0]?.attempts[0]).toMatchObject({
      sourceReportedTotal: 200,
      recordsReceived: 200,
      recordsParsed: 0,
      recordsEvaluable: 0,
      recordsEvaluated: 0,
      validationStatus: "failed",
    });
    expect(result.sources[0]?.attempts[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "records_not_normalized", count: 200 }),
    );
  });
  test("a replayed second page fails distinct-identity pagination evidence", async () => {
    const record = {
      title: "Reliability Gardener",
      externalPath: "/job/role-1",
    };
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "workday", version: 1 },
            url: fixtures.workday.url,
            active: true,
            variables: { tenant: "example", site: "External" },
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
              body: JSON.stringify({ total: 2, jobPostings: [record] }),
            };
          },
        },
      },
    );
    expect(result.sources[0]?.status).toBe("failed");
    expect(result.sources[0]?.attempts[1]).toMatchObject({
      uniqueIdentities: 0,
      validationStatus: "failed",
    });
    expect(result.sources[0]?.attempts[1]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "pagination_replayed" }),
    );
  });
  test("validation dispositions reconcile on the page that produced each record", async () => {
    let pageNumber = 0;
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            template: { id: "smartrecruiters", version: 1 },
            url: fixtures.smartrecruiters.url,
            active: true,
          },
        ],
      },
      {
        http: {
          async request(input) {
            pageNumber++;
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                totalFound: 101,
                content: [
                  {
                    id: `role-${pageNumber}`,
                    name: `Synthetic Role ${pageNumber}`,
                    postingUrl:
                      pageNumber === 1
                        ? "http://careers.example.test/jobs/role-1"
                        : "https://careers.example.test/jobs/role-2",
                  },
                ],
              }),
            };
          },
        },
      },
    );

    expect(result.sources[0]?.attempts[0]).toMatchObject({
      recordsReceived: 1,
      acceptedCount: 0,
      rejectedCount: 1,
    });
    expect(result.sources[0]?.attempts[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_official_url", count: 1 }),
    );
    expect(result.sources[0]?.attempts[1]).toMatchObject({
      recordsReceived: 1,
      acceptedCount: 1,
      rejectedCount: 0,
    });
    expect(result.sources[0]?.attempts[1]?.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "invalid_official_url" }),
    );
  });
});

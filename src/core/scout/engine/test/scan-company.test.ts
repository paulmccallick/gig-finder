import { describe, expect, test } from "bun:test";
import {
  retrieveOfficialDescription,
  scanCompany,
  type GigScoutHttpPort,
} from "..";

describe("scanCompany", () => {
  test("generic JSON can acquire a root-array listing surface", async () => {
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            url: "https://careers.example.test/jobs",
            active: true,
            method: "GET",
            recordsPath: "$",
            fields: {
              id: "id",
              title: "title",
              url: "detail.url",
            },
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
              body: JSON.stringify([
                {
                  id: "role-1",
                  title: "Synthetic Gardener",
                  detail: {
                    url: "https://careers.example.test/jobs/role-1",
                  },
                },
              ]),
            };
          },
        },
      },
    );
    expect(result.positions).toHaveLength(1);
  });
  test("scans only immutable request configuration and deduplicates synthetic results", async () => {
    const http: GigScoutHttpPort = {
      async request() {
        return {
          status: 200,
          url: "https://careers.example.test/jobs",
          headers: {},
          body: JSON.stringify({
            jobs: [
              {
                id: "job-1",
                title: "Systems Gardener",
                url: "/jobs/1",
                description: "Grow reliable systems.",
              },
              { id: "job-1", title: "Systems Gardener", url: "/jobs/1" },
            ],
          }),
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
            url: "https://careers.example.test/jobs",
            recordsPath: "jobs",
            fields: {
              id: "id",
              title: "title",
              url: "url",
              description: "description",
            },
            active: true,
            method: "GET",
          },
        ],
      },
      { http, clock: { now: () => new Date("2026-01-01T00:00:00.000Z") } },
    );
    expect(result.positions).toHaveLength(1);
    expect(result.sources[0]?.status).toBe("succeeded_with_results");
    expect(result.sources[0]?.attempts[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate_identity", count: 1 }),
    );
    expect(result.positions[0]?.description).toBe("Grow reliable systems.");
  });

  test("distinguishes verified and suspicious empty listing surfaces", async () => {
    const scan = (body: string) =>
      scanCompany(
        {
          companyId: "company-1",
          configurationVersionId: "config-1",
          sources: [
            {
              key: "official",
              type: "html",
              url: "https://careers.example.test/jobs",
              listingSelector: "article.posting",
              titleField: { selector: "h2" },
              urlField: { selector: "a", attribute: "href" },
              listingSurfaceSelector: "main.jobs",
              emptyStateSelector: ".empty",
              active: true,
            },
          ],
        },
        {
          http: {
            async request() {
              return {
                status: 200,
                url: "https://careers.example.test/jobs",
                headers: {},
                body,
              };
            },
          },
        },
      );
    expect(
      (await scan('<main class="jobs"><p class="empty">None</p></main>'))
        .sources[0]?.status,
    ).toBe("succeeded_empty_verified");
    expect((await scan("<main></main>")).sources[0]?.status).toBe(
      "suspicious_empty",
    );
  });
  test("retries bounded transient failures and records each attempt", async () => {
    let calls = 0;
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            url: "https://careers.example.test/jobs",
            recordsPath: "jobs",
            fields: { title: "title", url: "url" },
            active: true,
            method: "GET",
          },
        ],
      },
      {
        http: {
          async request() {
            calls++;
            if (calls < 3) throw new Error("temporary_network_failure");
            return {
              status: 200,
              url: "https://careers.example.test/jobs",
              headers: {},
              body: JSON.stringify({
                jobs: [{ title: "Systems Gardener", url: "/jobs/1" }],
              }),
            };
          },
        },
      },
    );
    expect(calls).toBe(3);
    expect(result.sources[0]?.attempts).toHaveLength(3);
    expect(result.sources[0]?.status).toBe("succeeded_with_results");
  });
  test("preserves successful pages as partial when later pagination fails", async () => {
    let calls = 0;
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            url: "https://careers.example.test/jobs",
            recordsPath: "jobs",
            nextPagePath: "next",
            fields: { title: "title", url: "url" },
            active: true,
            method: "GET",
          },
        ],
      },
      {
        http: {
          async request() {
            calls++;
            if (calls > 1) throw new Error("temporary_network_failure");
            return {
              status: 200,
              url: "https://careers.example.test/jobs",
              headers: {},
              body: JSON.stringify({
                next: true,
                jobs: [{ title: "Systems Gardener", url: "/jobs/1" }],
              }),
            };
          },
        },
      },
    );
    expect(result.sources[0]?.status).toBe("partial");
    expect(result.positions).toHaveLength(1);
    expect(result.sources[0]?.attempts).toHaveLength(4);
  });
  test("extracts generic JSON selected from an HTML script envelope", async () => {
    const result = await scanCompany(
        {
          companyId: "company-1",
          configurationVersionId: "config-1",
          sources: [
            {
              key: "official",
              type: "json",
              url: "https://careers.example.test/jobs",
              method: "GET",
              scriptEnvelope: {
                selector: "script#jobs-data",
                valuePath: "payload",
              },
              recordsPath: "jobs",
              fields: { title: "title", url: "url" },
              active: true,
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
                body: `<script id="jobs-data" type="application/json">{"payload":{"jobs":[{"title":"Synthetic Gardener","url":"/jobs/one"}]}}</script>`,
              };
            },
          },
        },
      );
    expect(result.positions).toHaveLength(1);
  });
  test("cancellation stops the whole company scan", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      scanCompany(
        {
          companyId: "company-1",
          configurationVersionId: "config-1",
          sources: [
            {
              key: "one",
              type: "json",
              url: "https://careers.example.test/one",
              recordsPath: "jobs",
              fields: { title: "title", url: "url" },
              active: true,
              method: "GET",
            },
            {
              key: "two",
              type: "json",
              url: "https://careers.example.test/two",
              recordsPath: "jobs",
              fields: { title: "title", url: "url" },
              active: true,
              method: "GET",
            },
          ],
        },
        {
          signal: controller.signal,
          http: {
            async request() {
              calls++;
              controller.abort();
              throw new DOMException("cancelled", "AbortError");
            },
          },
        },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
  test("retrieves a bounded official description through the HTTP port", async () => {
    let request: Parameters<GigScoutHttpPort["request"]>[0] | undefined;
    const description = await retrieveOfficialDescription(
      "https://careers.example.test/jobs/1",
      {
        async request(input) {
          request = input;
          return {
            status: 200,
            url: input.url,
            headers: {},
            body: "Exact official description.",
          };
        },
      },
    );
    expect(description).toBe("Exact official description.");
    expect(request).toMatchObject({
      timeoutMs: 15_000,
      maxResponseBytes: 1_000_000,
    });
  });
  test("normalizes source HTML descriptions before artifact persistence", async () => {
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            url: "https://careers.example.test/jobs",
            recordsPath: "jobs",
            fields: { title: "title", url: "url", description: "description" },
            active: true,
            method: "GET",
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
                jobs: [
                  {
                    title: "Systems Gardener",
                    url: "/jobs/1",
                    description:
                      "<p>Build &amp; grow.</p><ul><li>Kind</li><li>Reliable</li></ul>",
                  },
                ],
              }),
            };
          },
        },
      },
    );
    expect(result.positions[0]?.description).toBe(
      "Build & grow.\n\n- Kind\n- Reliable",
    );
  });
  test("generic JSON follows a source-provided next link until exhaustion", async () => {
    const requests: string[] = [];
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            url: "https://careers.example.test/jobs",
            recordsPath: "jobs",
            nextPagePath: "next",
            fields: { title: "title", url: "url" },
            active: true,
            method: "GET",
          },
        ],
      },
      {
        http: {
          async request(input) {
            requests.push(input.url);
            const secondPage = requests.length === 2;
            return {
              status: 200,
              url: input.url,
              headers: {},
              body: JSON.stringify({
                jobs: [
                  {
                    title: `Synthetic Role ${requests.length}`,
                    url: `/jobs/${requests.length}`,
                  },
                ],
                next: secondPage ? null : "/jobs?cursor=next",
              }),
            };
          },
        },
      },
    );
    expect(requests).toEqual([
      "https://careers.example.test/jobs?page=1",
      "https://careers.example.test/jobs?cursor=next",
    ]);
    expect(result.sources[0]?.status).toBe("succeeded_with_results");
  });
  test("an empty page cannot verify success while advertising more results", async () => {
    const result = await scanCompany(
      {
        companyId: "company-1",
        configurationVersionId: "config-1",
        sources: [
          {
            key: "official",
            type: "json",
            url: "https://careers.example.test/jobs",
            recordsPath: "jobs",
            nextPagePath: "next",
            fields: { title: "title", url: "url" },
            active: true,
            method: "GET",
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
              body: JSON.stringify({ jobs: [], next: "/jobs?cursor=next" }),
            };
          },
        },
      },
    );
    expect(result.sources[0]?.status).toBe("failed");
    expect(result.sources[0]?.attempts[0]?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "pagination_empty_before_exhaustion",
      }),
    );
  });
});

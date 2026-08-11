import { describe, expect, test } from "bun:test";
import { scanCompany, type GigScoutHttpPort } from "..";

describe("scanCompany", () => {
  test("scans only immutable request configuration and deduplicates synthetic results", async () => {
    const http: GigScoutHttpPort = { async request() { return { status: 200, url: "https://careers.example.test/jobs", headers: {}, body: JSON.stringify({ jobs: [{ id: "job-1", title: "Systems Gardener", url: "/jobs/1", description: "Grow reliable systems." }, { id: "job-1", title: "Systems Gardener", url: "/jobs/1" }] }) }; } };
    const result = await scanCompany({ companyId: "company-1", configurationVersionId: "config-1", sources: [{ key: "official", type: "json", url: "https://careers.example.test/jobs", recordsPath: "jobs", fields: { id: "id", title: "title", url: "url", description: "description" }, active: true, maxPages: 1, method: "GET" }] }, { http, clock: { now: () => new Date("2026-01-01T00:00:00.000Z") } });
    expect(result.positions).toHaveLength(1);
    expect(result.sources[0]?.status).toBe("partial");
    expect(result.positions[0]?.description).toBe("Grow reliable systems.");
  });

  test("distinguishes verified and suspicious empty listing surfaces", async () => {
    const scan = (body: string) => scanCompany({ companyId: "company-1", configurationVersionId: "config-1", sources: [{ key: "official", type: "html", url: "https://careers.example.test/jobs", listingPattern: "<article>(.*?)</article>", titlePattern: "<h2>(.*?)</h2>", urlPattern: "href=\"(.*?)\"", expectedSurfacePattern: "data-job-list", active: true, maxPages: 1 }] }, { http: { async request() { return { status: 200, url: "https://careers.example.test/jobs", headers: {}, body }; } } });
    expect((await scan('<main data-job-list="true"></main>')).sources[0]?.status).toBe("succeeded_empty_verified");
    expect((await scan("<main></main>")).sources[0]?.status).toBe("suspicious_empty");
  });
  test("retries bounded transient failures and records each attempt",async()=>{let calls=0;const result=await scanCompany({companyId:"company-1",configurationVersionId:"config-1",sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{title:"title",url:"url"},active:true,maxPages:1,method:"GET"}]},{http:{async request(){calls++;if(calls<3)throw new Error("temporary_network_failure");return{status:200,url:"https://careers.example.test/jobs",headers:{},body:JSON.stringify({jobs:[{title:"Systems Gardener",url:"/jobs/1"}]})};}}});expect(calls).toBe(3);expect(result.sources[0]?.attempts).toHaveLength(3);expect(result.sources[0]?.status).toBe("succeeded_with_results");});
  test("preserves successful pages as partial when later pagination fails",async()=>{let calls=0;const result=await scanCompany({companyId:"company-1",configurationVersionId:"config-1",sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",nextPagePath:"next",fields:{title:"title",url:"url"},active:true,maxPages:2,method:"GET"}]},{http:{async request(){calls++;if(calls>1)throw new Error("temporary_network_failure");return{status:200,url:"https://careers.example.test/jobs",headers:{},body:JSON.stringify({next:true,jobs:[{title:"Systems Gardener",url:"/jobs/1"}]})};}}});expect(result.sources[0]?.status).toBe("partial");expect(result.positions).toHaveLength(1);expect(result.sources[0]?.attempts).toHaveLength(4);});
  test("rejects HTML patterns with unsupported backtracking constructs",async()=>{await expect(scanCompany({companyId:"company-1",configurationVersionId:"config-1",sources:[{key:"official",type:"html",url:"https://careers.example.test/jobs",listingPattern:"(a+)+",titlePattern:"<h2>(.*?)</h2>",urlPattern:"href=\"(.*?)\"",expectedSurfacePattern:"jobs",active:true,maxPages:1}]},{http:{async request(){throw new Error("not reached");}}})).rejects.toThrow("unsupported backtracking");});
});

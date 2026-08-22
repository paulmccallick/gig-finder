import { describe, expect, test } from "bun:test";
import { acquirePlannedDescription } from "../../sourcing/detail-descriptions";
import type { GigScoutHttpPort } from "../../sourcing/ports";
import { planInlineDetailRequest } from "../../sourcing/source-plan";

const http=(body:string,contentType:string):GigScoutHttpPort=>({async request(input){return{status:200,url:input.url,headers:{"content-type":contentType},body};}});
const request={url:"https://careers.example.test/details/42",method:"GET" as const,headers:{}};

describe("configured detail description acquisition",()=>{
  test("plans inline origin and position URL tokens without corrupting URL structure",()=>{
    expect(planInlineDetailRequest({sourceUrl:"https://careers.example.test/search",urlTemplate:"{source.origin}/jobs/{position.id}",method:"GET",headers:{}},{id:"role / 42",title:"Synthetic",url:"https://careers.example.test/jobs/42"}).url).toBe("https://careers.example.test/jobs/role%20%2F%2042");
    expect(planInlineDetailRequest({sourceUrl:"https://careers.example.test/search",urlTemplate:"{position.url}",method:"GET",headers:{}},{id:"42",title:"Synthetic",url:"https://careers.example.test/jobs/42"}).url).toBe("https://careers.example.test/jobs/42");
  });
  test("extracts an authoritative JSON field and validates identity",async()=>{
    const result=await acquirePlannedDescription({request,response:"json",descriptionPath:"job.description",identity:{idPath:"job.id",titlePath:"job.title"},strategyVersion:"json-field-v1"},{id:"42",title:"Director of Synthetic Systems"},http(JSON.stringify({job:{id:"42",title:"Director of Synthetic Systems",description:"## Scope\n\nBuild reliable systems."}}),"application/json"));
    expect(result.markdown).toBe("## Scope\n\nBuild reliable systems.");
    expect(result.extractedContentHash).toHaveLength(64);
  });

  test("extracts only the configured DOM description",async()=>{
    const body='<nav>Ignore navigation</nav><h1>Director of Synthetic Systems</h1><main><article class="description"><h2>Scope</h2><ul><li><a href="https://careers.example.test/team">Lead synthetic systems.</a></li></ul></article></main><aside>Ignore recommendations</aside>';
    const result=await acquirePlannedDescription({request,response:"html",extractor:{type:"dom",selector:"article.description",titleSelector:"h1"},strategyVersion:"html-dom-v1"},{id:"42",title:"Director of Synthetic Systems"},http(body,"text/html"));
    expect(result.markdown).toContain("## Scope");expect(result.markdown).toContain("[Lead synthetic systems.](https://careers.example.test/team)");expect(result.markdown).not.toContain("navigation");
  });

  test("selects the matching Schema.org JobPosting and rejects ambiguity",async()=>{
    const posting=(description:string)=>`<script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",title:"Director of Synthetic Systems",identifier:{value:"42"},description})}</script>`;
    const result=await acquirePlannedDescription({request,response:"html",extractor:{type:"json-ld"},strategyVersion:"html-json-ld-v1"},{id:"42",title:"Director of Synthetic Systems"},http(posting("<p>Authoritative description.</p>"),"text/html"));
    expect(result.markdown).toBe("Authoritative description.");
    await expect(acquirePlannedDescription({request,response:"html",extractor:{type:"json-ld"},strategyVersion:"html-json-ld-v1"},{id:"different",title:"Different role"},http(posting("Wrong role"),"text/html"))).rejects.toThrow("description_identity_mismatch");
    await expect(acquirePlannedDescription({request,response:"html",extractor:{type:"json-ld"},strategyVersion:"html-json-ld-v1"},{id:"42",title:"Director of Synthetic Systems"},http(posting("One")+posting("Two"),"text/html"))).rejects.toThrow("description_ambiguous");
  });
});

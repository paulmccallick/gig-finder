import assert from "node:assert/strict";
import { heapStats } from "bun:jsc";
import { extractHtmlSelectors } from "../../../sourcing/extractors/html-selectors";
import { acquirePlannedDescription } from "../../../sourcing/detail-descriptions";
import type { SourceConfiguration } from "../../../sourcing/contracts";

const mode = process.argv[2];
const listingSource: Extract<SourceConfiguration, { type: "html" }> = {
  key: "official",
  type: "html",
  active: true,
  url: "https://careers.example.test/jobs",
  listingSurfaceSelector: "main",
  listingSelector: "article",
  titleField: { selector: "h2" },
  urlField: { selector: "a", attribute: "href" },
};

async function extract(index: number) {
  // Unique, large input pages expose captured request bodies without expensive
  // Markdown conversion of huge descriptions or any real career-site content.
  const padding = `<aside>${index}:${"x".repeat(512 * 1024)}</aside>`;
  if (mode === "listing") {
    const result = await extractHtmlSelectors(listingSource,
      `<main>${padding}<article><h2>Director</h2><a href="/jobs/42">Apply</a></article></main>`, 1);
    assert.equal(result.positions[0]?.title, "Director");
    assert.equal(result.positions[0]?.canonicalUrl, "https://careers.example.test/jobs/42");
    return;
  }
  const description = "<section class='description'><p>Lead teams.</p><ul><li>Build systems.</li></ul></section>";
  const body = mode === "json-ld"
    ? `${padding}<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: "Director", identifier: { value: "42" },
        description: "<p>Lead teams.</p>",
      })}</script>`
    : `${padding}<h1>Director</h1>${description}${mode === "ambiguous" ? description : ""}`;
  try {
    const result = await acquirePlannedDescription({
      request: { url: "https://careers.example.test/jobs/42", method: "GET", headers: {} },
      response: "html",
      extractor: mode === "json-ld" ? { type: "json-ld" } : {
        type: "dom", selector: ".description", titleSelector: "h1",
      },
      contentFormat: "html",
      contentEncoding: "none",
      strategyVersion: "memory-regression-v1",
    }, { id: "42", title: "Director" }, {
      async request(input) {
        return { status: 200, url: input.url, headers: { "content-type": "text/html" }, body };
      },
    });
    assert.notEqual(mode, "ambiguous");
    assert.match(result.markdown, /Lead teams\./);
  } catch (error) {
    if (mode !== "ambiguous") throw error;
    assert.equal((error as Error).message, "description_ambiguous");
  }
}

async function measure() {
  // Allow native finalizers and async continuations to release their roots.
  for (let tick = 0; tick < 3; tick++) {
    Bun.gc(true);
    await Bun.sleep(10);
  }
  return {
    external: process.memoryUsage().external,
    protectedFunctions: heapStats().protectedObjectTypeCounts.Function ?? 0,
  };
}

for (let index = 0; index < 10; index++) await extract(index);
const before = await measure();
for (let index = 10; index < 110; index++) await extract(index);
const after = await measure();
console.log(JSON.stringify({
  mode, before, after,
  externalGrowth: after.external - before.external,
  protectedFunctionGrowth: after.protectedFunctions - before.protectedFunctions,
}));


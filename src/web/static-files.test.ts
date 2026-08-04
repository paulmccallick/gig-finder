import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStaticFileHandler } from "./static-files";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("production static files", () => {
  test("serves assets and falls back to the SPA without handling API paths", async () => {
    const temporaryRoot = path.resolve(import.meta.dir, "../../tmp");
    await mkdir(temporaryRoot, { recursive: true });
    directory = await mkdtemp(path.join(temporaryRoot, "static-files-"));
    await mkdir(path.join(directory, "assets"));
    await writeFile(path.join(directory, "index.html"), "<main>GigFinder</main>");
    await writeFile(path.join(directory, "assets", "app.js"), "export {};");
    const handler = createStaticFileHandler(directory);

    const asset = await handler(new Request("http://localhost/assets/app.js"));
    expect(asset?.status).toBe(200);
    expect(asset?.headers.get("cache-control")).toContain("immutable");
    expect(await asset?.text()).toBe("export {};");

    const fallback = await handler(new Request("http://localhost/gigs/example"));
    expect(await fallback?.text()).toBe("<main>GigFinder</main>");
    expect(fallback?.headers.get("cache-control")).toBe("no-cache");
    expect(await handler(new Request("http://localhost/api/gigs"))).toBeNull();
    expect(await handler(new Request("http://localhost/missing.js"))).toBeNull();
  });
});

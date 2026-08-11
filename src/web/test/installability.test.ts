import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const webRoot = path.resolve(import.meta.dir, "..");
const publicRoot = path.join(webRoot, "public");

async function pngDimensions(filePath: string): Promise<[number, number]> {
  const bytes = new Uint8Array(await readFile(filePath));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  expect(Array.from(bytes.slice(0, 8))).toEqual(signature);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

describe("installed web application", () => {
  test("publishes a standalone manifest with Chromium and iOS icons", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(publicRoot, "manifest.webmanifest"), "utf8"),
    ) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      id: "/",
      name: "GigFinder",
      short_name: "GigFinder",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f5f3ed",
      theme_color: "#071014",
    });
    expect(manifest.icons).toEqual([
      expect.objectContaining({ src: "/icons/gig-finder-192.png", sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ src: "/icons/gig-finder-512.png", sizes: "512x512", type: "image/png" }),
    ]);
    expect(await pngDimensions(path.join(publicRoot, "icons/gig-finder-180.png"))).toEqual([180, 180]);
    expect(await pngDimensions(path.join(publicRoot, "icons/gig-finder-192.png"))).toEqual([192, 192]);
    expect(await pngDimensions(path.join(publicRoot, "icons/gig-finder-512.png"))).toEqual([512, 512]);
  });

  test("links Chromium and iOS install metadata", async () => {
    const index = await readFile(path.join(webRoot, "index.html"), "utf8");
    expect(index).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(index).toContain('rel="apple-touch-icon" sizes="180x180"');
    expect(index).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });
});

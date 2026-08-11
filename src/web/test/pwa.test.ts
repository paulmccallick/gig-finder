import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pwaCacheStrategy } from "../pwa-cache-policy";

const publicRoot = path.resolve(import.meta.dir, "../public");

describe("PWA assets and cache boundary", () => {
  test("provides an installable standalone manifest with application icons", async () => {
    const manifest = JSON.parse(await readFile(path.join(publicRoot, "manifest.webmanifest"), "utf8")) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest).toMatchObject({
      name: "GigFinder",
      short_name: "GigFinder",
      start_url: "/",
      display: "standalone",
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(["192x192", "512x512"]);
    await Promise.all(manifest.icons.map(icon =>
      expect(Bun.file(path.join(publicRoot, icon.src)).exists()).resolves.toBe(true)));
  });

  test("caches only navigation shell and same-origin versioned static assets", () => {
    const strategy = (requestUrl: string, mode = "cors", method = "GET") => pwaCacheStrategy({
      requestUrl,
      mode,
      method,
      applicationOrigin: "https://gig-finder.test",
    });
    expect(strategy("https://gig-finder.test/gigs/one", "navigate")).toBe("navigation-network-first");
    expect(strategy("https://gig-finder.test/assets/app-a1b2.js")).toBe("static-cache-first");
    expect(strategy("https://gig-finder.test/api/gigs")).toBe("network-only");
    expect(strategy("https://gig-finder.test/api/agent", "cors", "POST")).toBe("network-only");
    expect(strategy("https://gig-finder.test/healthz")).toBe("network-only");
    expect(strategy("https://cdn.example/assets/app.js")).toBe("network-only");
  });

  test("registers the worker and implements explicit update activation and offline fallback", async () => {
    const client = await readFile(path.resolve(import.meta.dir, "../client/pwa.tsx"), "utf8");
    const worker = await readFile(path.resolve(import.meta.dir, "../service-worker.ts"), "utf8");
    expect(client).toContain("navigator.serviceWorker.register");
    expect(client).toContain("SKIP_WAITING");
    expect(client).toContain("controllerchange");
    expect(worker).toContain("caches.match(SHELL_PATH)");
    expect(worker).toContain("name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME");
  });
});

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { observeServiceWorker, type ServiceWorkerUpdate } from "../client/pwa-registration";
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

  test("registers the revisioned worker, activates a waiting update, and reloads once", async () => {
    class Worker extends EventTarget {
      constructor(public state: ServiceWorkerState) { super(); }
      messages: unknown[] = [];
      postMessage(message: unknown) { this.messages.push(message); }
    }
    class Registration extends EventTarget {
      waiting: Worker | null = new Worker("installed");
      installing: Worker | null = null;
      updateCalls = 0;
      async update() { this.updateCalls += 1; }
    }
    class Container extends EventTarget {
      controller = {} as ServiceWorker;
      registration = new Registration();
      requestedUrl = "";
      async register(url: string) {
        this.requestedUrl = url;
        return this.registration as unknown as ServiceWorkerRegistration;
      }
    }
    const container = new Container();
    const updates: ServiceWorkerUpdate[] = [];
    const scheduled: Array<() => void> = [];
    let reloads = 0;
    let cancelled = false;
    const cleanup = await observeServiceWorker({
      serviceWorkers: container as unknown as ServiceWorkerContainer,
      revision: "revision one",
      schedule: callback => { scheduled.push(callback); return 7; },
      cancelSchedule: timer => { cancelled = timer === 7; },
      reload: () => { reloads += 1; },
    }, update => updates.push(update));

    expect(container.requestedUrl).toBe("/service-worker.js?revision=revision%20one");
    expect(updates).toHaveLength(1);
    updates[0]?.activate();
    expect(container.registration.waiting?.messages).toEqual([{ type: "SKIP_WAITING" }]);
    scheduled[0]?.();
    await Promise.resolve();
    expect(container.registration.updateCalls).toBe(1);
    const installing = new Worker("installing");
    container.registration.installing = installing;
    container.registration.dispatchEvent(new Event("updatefound"));
    container.registration.installing = null;
    installing.state = "installed";
    installing.dispatchEvent(new Event("statechange"));
    expect(updates).toHaveLength(2);
    updates[1]?.activate();
    expect(installing.messages).toEqual([{ type: "SKIP_WAITING" }]);
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reloads).toBe(1);
    cleanup();
    expect(cancelled).toBe(true);
  });
});

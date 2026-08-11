import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runInNewContext } from "node:vm";

const revision = "1111111111111111111111111111111111111111";
const cacheName = `gig-finder-static-${revision}`;

class MemoryCache {
  readonly entries = new Map<string, Response>();

  private key(request: RequestInfo | URL) {
    if (typeof request === "string") return new URL(request, "https://gig-finder.test").pathname;
    if (request instanceof URL) return request.pathname;
    return new URL(request.url).pathname;
  }

  async put(request: RequestInfo | URL, response: Response) {
    this.entries.set(this.key(request), response.clone());
  }

  async match(request: RequestInfo | URL) {
    return this.entries.get(this.key(request))?.clone();
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();
  async open(name: string) {
    const cache = this.stores.get(name) ?? new MemoryCache();
    this.stores.set(name, cache);
    return cache;
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name: string) { return this.stores.delete(name); }
}

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike {
  request: { method: string; mode: string; url: string };
  respondWith(promise: Promise<Response>): void;
}

async function workerHarness() {
  const result = await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "../service-worker.ts")],
    target: "browser",
    format: "iife",
    minify: false,
    define: { __APP_REVISION__: JSON.stringify(revision) },
  });
  if (!result.success) throw new Error("Could not build service-worker fixture.");
  const source = await result.outputs[0]!.text();
  const listeners = new Map<string, Array<(event: never) => void>>();
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let failNavigation = false;
  const requested: string[] = [];
  const caches = new MemoryCacheStorage();
  const self = {
    location: { origin: "https://gig-finder.test" },
    clients: { claim: async () => { claimCalls += 1; } },
    skipWaiting: async () => { skipWaitingCalls += 1; },
    addEventListener(type: string, listener: (event: never) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  const fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? new URL(input, self.location.origin)
      : input instanceof URL ? input : new URL(input.url);
    requested.push(url.pathname);
    if (failNavigation && url.pathname.startsWith("/documents/")) throw new TypeError("offline");
    if (url.pathname === "/") return new Response(
      '<script src="/assets/app-abc.js"></script><link href="/assets/app-def.css"><a href="/api/gigs">',
      { status: 200, headers: { "content-type": "text/html" } },
    );
    return new Response(`asset:${url.pathname}`, { status: 200 });
  };
  runInNewContext(source, { self, caches, fetch, URL, Response });

  const dispatchWaitable = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    const event = { ...extra, waitUntil: (promise: Promise<unknown>) => waits.push(promise) } as ExtendableEventLike;
    for (const listener of listeners.get(type) ?? []) listener(event as never);
    await Promise.all(waits);
  };
  const dispatchFetch = async (request: FetchEventLike["request"]) => {
    const responses: Array<Promise<Response>> = [];
    const event: FetchEventLike = { request, respondWith: promise => { responses.push(promise); } };
    for (const listener of listeners.get("fetch") ?? []) listener(event as never);
    return responses[0] ? await responses[0] : null;
  };
  return {
    caches, requested,
    install: () => dispatchWaitable("install"),
    activate: () => dispatchWaitable("activate"),
    message: (data: unknown) => dispatchWaitable("message", { data }),
    fetch: dispatchFetch,
    goOffline: () => { failNavigation = true; },
    skipWaitingCalls: () => skipWaitingCalls,
    claimCalls: () => claimCalls,
  };
}

describe("service worker runtime", () => {
  test("keeps revision-specific shell assets isolated and removes stale caches", async () => {
    const worker = await workerHarness();
    worker.caches.stores.set("gig-finder-static-old", new MemoryCache());
    worker.caches.stores.set("unrelated-cache", new MemoryCache());
    await worker.install();
    expect([...worker.caches.stores.get(cacheName)!.entries.keys()].sort()).toEqual([
      "/", "/assets/app-abc.js", "/assets/app-def.css",
    ]);
    expect(worker.requested).not.toContain("/api/gigs");
    await worker.activate();
    expect(await worker.caches.keys()).toEqual(["unrelated-cache", cacheName]);
    expect(worker.claimCalls()).toBe(1);
  });

  test("uses only the current cache for offline deep links and never intercepts private data", async () => {
    const worker = await workerHarness();
    await worker.install();
    const stale = await worker.caches.open("gig-finder-static-old");
    await stale.put("/", new Response("stale shell"));
    worker.goOffline();
    const response = await worker.fetch({
      method: "GET", mode: "navigate",
      url: "https://gig-finder.test/documents/doc_111/versions/1",
    });
    expect(await response?.text()).toContain("/assets/app-abc.js");
    expect(await worker.fetch({ method: "GET", mode: "cors", url: "https://gig-finder.test/api/gigs" })).toBeNull();
    expect(await worker.fetch({ method: "GET", mode: "cors", url: "https://gig-finder.test/healthz" })).toBeNull();
    expect(await worker.fetch({ method: "POST", mode: "cors", url: "https://gig-finder.test/api/agent" })).toBeNull();
  });

  test("activates a waiting worker only after the client message", async () => {
    const worker = await workerHarness();
    await worker.message({ type: "OTHER" });
    expect(worker.skipWaitingCalls()).toBe(0);
    await worker.message({ type: "SKIP_WAITING" });
    expect(worker.skipWaitingCalls()).toBe(1);
  });
});

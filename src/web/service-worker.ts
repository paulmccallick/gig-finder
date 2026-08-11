/// <reference lib="webworker" />

import { pwaCacheStrategy } from "./pwa-cache-policy";

declare const self: ServiceWorkerGlobalScope;
declare const __APP_REVISION__: string;

const CACHE_PREFIX = "gig-finder-static-";
const CACHE_NAME = `${CACHE_PREFIX}${__APP_REVISION__}`;
const SHELL_PATH = "/";

async function cacheApplicationShell() {
  const response = await fetch(SHELL_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error(`Shell returned ${response.status}`);
  const html = await response.clone().text();
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .flatMap(match => match[1] ? [new URL(match[1], self.location.origin)] : [])
    .filter(url => pwaCacheStrategy({
      method: "GET",
      mode: "same-origin",
      requestUrl: url.href,
      applicationOrigin: self.location.origin,
    }) === "static-cache-first")
    .map(url => url.pathname);
  const cache = await caches.open(CACHE_NAME);
  await cache.put(SHELL_PATH, response);
  await Promise.all(assetPaths.map(async path => {
    const asset = await fetch(path, { cache: "no-store" });
    if (asset.ok) await cache.put(path, asset);
  }));
}

self.addEventListener("install", event => {
  event.waitUntil(cacheApplicationShell());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if ((event.data as { type?: unknown } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const strategy = pwaCacheStrategy({
    method: request.method,
    mode: request.mode,
    requestUrl: request.url,
    applicationOrigin: self.location.origin,
  });
  if (strategy === "navigation-network-first") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(SHELL_PATH)) ?? Response.error()));
    return;
  }
  if (strategy === "static-cache-first") {
    event.respondWith(caches.match(request).then(cached => cached ?? fetch(request)));
  }
});

export {};

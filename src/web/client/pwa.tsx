import { type ReactNode, useEffect, useState } from "react";

export interface ServiceWorkerUpdate {
  activate(): void;
}

export function registerPwa(onUpdate: (update: ServiceWorkerUpdate) => void) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.register(`/service-worker.js?revision=${encodeURIComponent(__APP_REVISION__)}`)
    .then(registration => {
      const offerUpdate = (worker: ServiceWorker | null) => {
        if (worker?.state !== "installed" || !navigator.serviceWorker.controller) return;
        onUpdate({ activate: () => worker.postMessage({ type: "SKIP_WAITING" }) });
      };
      offerUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", () => offerUpdate(registration.installing));
      });
      window.setInterval(() => void registration.update(), 60 * 60 * 1000);
    })
    .catch(() => {
      // Installation is an enhancement; ordinary browser use must keep working.
    });
}

export function PwaStatus({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [update, setUpdate] = useState<ServiceWorkerUpdate | null>(null);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    registerPwa(setUpdate);
    let reloading = false;
    const reload = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker?.addEventListener("controllerchange", reload);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      navigator.serviceWorker?.removeEventListener("controllerchange", reload);
    };
  }, []);

  return <>
    {children}
    {!online && <aside className="pwa-notice" role="status"><span><strong>GigFinder is offline</strong>The application shell is available, but live data and agent operations require the server.</span></aside>}
    {online && update && <aside className="pwa-notice" role="status"><span><strong>An update is ready</strong>Reload when convenient to use the newly deployed version.</span><button type="button" onClick={() => update.activate()}>Reload update</button></aside>}
  </>;
}

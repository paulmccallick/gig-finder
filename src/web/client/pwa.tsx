import { type ReactNode, useEffect, useState } from "react";
import { observeServiceWorker, type ServiceWorkerUpdate } from "./pwa-registration";

export function registerPwa(onUpdate: (update: ServiceWorkerUpdate) => void) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return Promise.resolve(() => {});

  return observeServiceWorker({
    serviceWorkers: navigator.serviceWorker,
    revision: __APP_REVISION__,
    schedule: window.setInterval.bind(window),
    cancelSchedule: window.clearInterval.bind(window),
    reload: () => window.location.reload(),
  }, onUpdate).catch(() => {
    // Installation is an enhancement; ordinary browser use must keep working.
    return () => {};
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
    let active = true;
    let cleanupWorker = () => {};
    void registerPwa(setUpdate).then(cleanup => {
      if (active) cleanupWorker = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      cleanupWorker();
    };
  }, []);

  return <>
    {children}
    {!online && <aside className="pwa-notice" role="status"><span><strong>GigFinder is offline</strong>The application shell is available, but live data and agent operations require the server.</span></aside>}
    {online && update && <aside className="pwa-notice" role="status"><span><strong>An update is ready</strong>Reload when convenient to use the newly deployed version.</span><button type="button" onClick={() => update.activate()}>Reload update</button></aside>}
  </>;
}

export interface ServiceWorkerUpdate {
  activate(): void;
}

interface RegistrationEnvironment {
  serviceWorkers: ServiceWorkerContainer;
  revision: string;
  schedule: (callback: () => void, delay: number) => number;
  cancelSchedule: (timer: number) => void;
  reload: () => void;
}

export async function observeServiceWorker(
  environment: RegistrationEnvironment,
  onUpdate: (update: ServiceWorkerUpdate) => void,
) {
  const registration = await environment.serviceWorkers.register(
    `/service-worker.js?revision=${encodeURIComponent(environment.revision)}`,
  );
  const offerUpdate = (worker: ServiceWorker | null) => {
    if (worker?.state !== "installed" || !environment.serviceWorkers.controller) return;
    onUpdate({ activate: () => worker.postMessage({ type: "SKIP_WAITING" }) });
  };
  const onInstallingStateChange = () => offerUpdate(registration.installing);
  const onUpdateFound = () => {
    registration.installing?.addEventListener("statechange", onInstallingStateChange);
  };
  offerUpdate(registration.waiting);
  registration.addEventListener("updatefound", onUpdateFound);

  let reloading = false;
  const onControllerChange = () => {
    if (reloading) return;
    reloading = true;
    environment.reload();
  };
  environment.serviceWorkers.addEventListener("controllerchange", onControllerChange);
  const timer = environment.schedule(() => void registration.update(), 60 * 60 * 1000);

  return () => {
    registration.removeEventListener("updatefound", onUpdateFound);
    registration.installing?.removeEventListener("statechange", onInstallingStateChange);
    environment.serviceWorkers.removeEventListener("controllerchange", onControllerChange);
    environment.cancelSchedule(timer);
  };
}

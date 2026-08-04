const root = new URL("../../", import.meta.url).pathname;
const developmentPorts = [3101, 5173, 4983] as const;
const shutdownTimeoutMs = 5_000;

function listenersOn(port: number): number[] {
  const result = Bun.spawnSync(
    ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    return [];
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to inspect port ${port}: ${result.stderr.toString().trim()}`,
    );
  }

  return result.stdout
    .toString()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
}

function activeDevelopmentPids(): number[] {
  return [...new Set(developmentPorts.flatMap(listenersOn))];
}

function signal(pids: number[], signalName: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signalName);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
  }
}

async function waitForListenersToStop(): Promise<number[]> {
  const deadline = Date.now() + shutdownTimeoutMs;
  let remaining = activeDevelopmentPids();

  while (remaining.length > 0 && Date.now() < deadline) {
    await Bun.sleep(100);
    remaining = activeDevelopmentPids();
  }

  return remaining;
}

async function stopExistingDevelopmentServers(): Promise<void> {
  const existing = activeDevelopmentPids();
  if (existing.length === 0) {
    console.log("No running development servers found.");
    return;
  }

  console.log(`Stopping development servers (${existing.join(", ")})...`);
  signal(existing, "SIGTERM");

  const remaining = await waitForListenersToStop();
  if (remaining.length > 0) {
    console.warn(`Forcing development servers to stop (${remaining.join(", ")})...`);
    signal(remaining, "SIGKILL");
    const stillRunning = await waitForListenersToStop();
    if (stillRunning.length > 0) {
      throw new Error(
        `Development ports are still occupied by processes: ${stillRunning.join(", ")}`,
      );
    }
  }
}

await stopExistingDevelopmentServers();

const environment = {
  ...process.env,
  AI_SDK_DEVTOOLS: "true",
};
const app = Bun.spawn(["bun", "run", "dev"], {
  cwd: root,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});
const devtools = Bun.spawn(["bun", "run", "dev:inspect"], {
  cwd: root,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});
const children = [app, devtools];
let stopping = false;
let shutdownRequested = false;

async function stopChildren(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(children.map((child) => child.exited));
}

function requestShutdown(): void {
  shutdownRequested = true;
  void stopChildren();
}

process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);

console.log("Development app and AI SDK DevTools are starting...");

const stopped = await Promise.race([
  app.exited.then((exitCode) => ({ name: "development app", exitCode })),
  devtools.exited.then((exitCode) => ({ name: "AI SDK DevTools", exitCode })),
]);

await stopChildren();
if (shutdownRequested) {
  process.exit(0);
}

console.error(`${stopped.name} stopped with exit code ${stopped.exitCode}.`);
process.exit(stopped.exitCode || 1);

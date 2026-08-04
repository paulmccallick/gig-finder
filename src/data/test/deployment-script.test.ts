import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");
const temporaryRoot = path.join(repositoryRoot, "tmp");
const deployScriptSource = path.join(repositoryRoot, "bin", "deploy-local.sh");
const revision = "a".repeat(40);

let directory = "";

const fakeDocker = `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  info|pull|stop|start|rename|rm|logs) exit 0 ;;
  image)
    echo 'ghcr.io/paulmccallick/gig-finder@sha256:test-digest'
    ;;
  container)
    if [ "$FAKE_OLD_CONTAINER" != true ]; then exit 1; fi
    case "$*" in
      *Config.Image*) echo 'ghcr.io/paulmccallick/gig-finder:sha-old' ;;
      *State.Running*) echo 'true' ;;
    esac
    ;;
  run)
    case "$*" in
      *'maintenance.js backup'*)
        echo '{"command":"backup","ok":true,"backup":{"path":"/var/lib/gig-finder/backups/test.sqlite"}}'
        ;;
      *'maintenance.js migrate'*)
        if [ "$FAKE_FAILURE" = migrate ]; then exit 9; fi
        echo '{"command":"migrate","ok":true}'
        ;;
      *'maintenance.js validate'*) echo '{"command":"validate","ok":true}' ;;
      *'maintenance.js restore'*) echo '{"command":"restore","ok":true}' ;;
      *'--detach'*) echo 'new-container-id' ;;
    esac
    ;;
esac
`;

const fakeCurl = `#!/bin/sh
set -eu
if [ "$FAKE_FAILURE" = health ]; then exit 22; fi
printf '{"status":"ok","revision":"%s"}\n' "$FAKE_REVISION"
`;

const fakeSleep = `#!/bin/sh
exit 0
`;

async function runDeployment(options: {
  failure?: "migrate" | "health";
  oldContainer?: boolean;
} = {}) {
  const productionRoot = path.join(directory, "repository", "production");
  const codexHome = path.join(directory, "codex");
  const deployScript = path.join(directory, "repository", "bin", "deploy-local.sh");
  const dockerPath = path.join(directory, "docker");
  const curlPath = path.join(directory, "curl");
  const sleepPath = path.join(directory, "sleep");
  const logPath = path.join(directory, "docker.log");
  await mkdir(path.join(productionRoot, "data"), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await mkdir(path.dirname(deployScript), { recursive: true });
  await writeFile(path.join(productionRoot, "data", "gig-finder.sqlite"), "fixture");
  await Promise.all([
    writeFile(deployScript, await readFile(deployScriptSource)),
    writeFile(dockerPath, fakeDocker),
    writeFile(curlPath, fakeCurl),
    writeFile(sleepPath, fakeSleep),
  ]);
  await Promise.all([
    chmod(deployScript, 0o755),
    chmod(dockerPath, 0o755),
    chmod(curlPath, 0o755),
    chmod(sleepPath, 0o755),
  ]);

  const child = Bun.spawn([deployScript, `sha-${revision}`], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GIG_FINDER_PRODUCTION_ROOT: productionRoot,
      GIG_FINDER_CODEX_HOME: codexHome,
      DOCKER_BIN: dockerPath,
      CURL_BIN: curlPath,
      SLEEP_BIN: sleepPath,
      FAKE_DOCKER_LOG: logPath,
      FAKE_REVISION: revision,
      FAKE_FAILURE: options.failure ?? "",
      FAKE_OLD_CONTAINER: options.oldContainer ? "true" : "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const log = await readFile(logPath, "utf8");
  return { stdout, stderr, exitCode, log };
}

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(path.join(temporaryRoot, "deployment-script-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("local production deployment", () => {
  test("pulls, backs up, migrates, validates, and starts the immutable image", async () => {
    const result = await runDeployment();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Deployment complete");
    const pull = result.log.indexOf(`pull ghcr.io/paulmccallick/gig-finder:sha-${revision}`);
    const backup = result.log.indexOf("maintenance.js backup");
    const migrate = result.log.indexOf("maintenance.js migrate");
    const validate = result.log.indexOf("maintenance.js validate");
    const start = result.log.indexOf("run --detach");
    expect([pull, backup, migrate, validate, start].every((position) => position >= 0)).toBe(true);
    expect(pull).toBeLessThan(backup);
    expect(backup).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(validate);
    expect(validate).toBeLessThan(start);
    expect(result.log).toContain(
      "-v " + path.join(directory, "repository", "production") + ":/var/lib/gig-finder",
    );
    expect(result.log).toContain("-v " + path.join(directory, "codex") + ":/run/codex:ro");
    expect(result.stdout + result.stderr).not.toContain(path.join(directory, "codex"));
  });

  test("restarts the prior container when migration fails", async () => {
    const result = await runDeployment({ failure: "migrate", oldContainer: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("migration or validation failed");
    expect(result.log).toContain("stop gig-finder");
    expect(result.log).toContain("maintenance.js restore /var/lib/gig-finder/backups/test.sqlite");
    expect(result.log).toContain("start gig-finder");
    expect(result.log).not.toContain("run --detach");
  });

  test("restores the backup and prior container when health verification fails", async () => {
    const result = await runDeployment({ failure: "health", oldContainer: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("restoring /var/lib/gig-finder/backups/test.sqlite");
    expect(result.log).toContain("maintenance.js restore /var/lib/gig-finder/backups/test.sqlite");
    expect(result.log).toContain("rename gig-finder-previous-");
    expect(result.log).toContain("start gig-finder");
  });
});

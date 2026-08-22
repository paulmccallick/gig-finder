import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
        echo '{"command":"backup","ok":true,"backup":{"path":"/var/backups/gig-finder/test.sqlite"}}'
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

const fakeSync = `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_SYNC_LOG"
case "\${1:-}" in
  --rollback|--finalize) echo '{"ok":true}' ;;
  *) echo '{"plan":{"transactionManifest":"/var/lib/gig-finder/data/deployment-inputs-test.json"}}' ;;
esac
`;

async function runDeployment(options: {
  failure?: "migrate" | "health";
  oldContainer?: boolean;
} = {}) {
  const sourceRoot = path.join(directory, "repository", "context");
  const productionRoot = path.join(directory, "var", "lib", "gig-finder");
  const logRoot = path.join(directory, "var", "log", "gig-finder");
  const backupRoot = path.join(directory, "var", "backups", "gig-finder");
  const configFile = path.join(directory, "etc", "gig-finder", "config.json");
  const actualConfigRoot = path.join(directory, "private", "etc");
  const codexHome = path.join(directory, "codex");
  const deployScript = path.join(directory, "repository", "bin", "deploy-local.sh");
  const dockerPath = path.join(directory, "docker");
  const curlPath = path.join(directory, "curl");
  const sleepPath = path.join(directory, "sleep");
  const syncPath = path.join(directory, "sync");
  const logPath = path.join(directory, "docker.log");
  const syncLogPath = path.join(directory, "sync.log");
  await mkdir(path.join(productionRoot, "data"), { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(logRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await mkdir(path.join(actualConfigRoot, "gig-finder"), { recursive: true });
  await symlink(actualConfigRoot, path.join(directory, "etc"), "dir");
  await mkdir(codexHome, { recursive: true });
  await mkdir(path.dirname(deployScript), { recursive: true });
  await writeFile(path.join(productionRoot, "data", "gig-finder.sqlite"), "fixture");
  await writeFile(configFile, '{}\n');
  const canonicalConfigFile = await realpath(configFile);
  await Promise.all([
    writeFile(deployScript, await readFile(deployScriptSource)),
    writeFile(dockerPath, fakeDocker),
    writeFile(curlPath, fakeCurl),
    writeFile(sleepPath, fakeSleep),
    writeFile(syncPath, fakeSync),
  ]);
  await Promise.all([
    chmod(deployScript, 0o755),
    chmod(dockerPath, 0o755),
    chmod(curlPath, 0o755),
    chmod(sleepPath, 0o755),
    chmod(syncPath, 0o755),
  ]);

  const child = Bun.spawn([deployScript, `sha-${revision}`], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GIG_FINDER_PRODUCTION_ROOT: productionRoot,
      GIG_FINDER_SOURCE_CONTEXT_ROOT: sourceRoot,
      GIG_FINDER_LOG_ROOT: logRoot,
      GIG_FINDER_BACKUP_ROOT: backupRoot,
      GIG_FINDER_CONFIG: configFile,
      GIG_FINDER_CODEX_HOME: codexHome,
      GIG_FINDER_SYNC_BIN: syncPath,
      DOCKER_BIN: dockerPath,
      CURL_BIN: curlPath,
      SLEEP_BIN: sleepPath,
      FAKE_DOCKER_LOG: logPath,
      FAKE_SYNC_LOG: syncLogPath,
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
  const [log, syncLog] = await Promise.all([
    readFile(logPath, "utf8"),
    readFile(syncLogPath, "utf8"),
  ]);
  return {
    stdout,
    stderr,
    exitCode,
    log,
    syncLog,
    productionRoot,
    logRoot,
    backupRoot,
    configFile,
    canonicalConfigFile,
  };
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
    const preflightValidate = result.log.indexOf("maintenance.js validate");
    const backup = result.log.indexOf("maintenance.js backup");
    const migrate = result.log.indexOf("maintenance.js migrate");
    const migrationValidate = result.log.indexOf("maintenance.js validate", migrate);
    const start = result.log.indexOf("run --detach");
    expect([pull, preflightValidate, backup, migrate, migrationValidate, start].every((position) => position >= 0)).toBe(true);
    expect(pull).toBeLessThan(backup);
    expect(preflightValidate).toBeLessThan(backup);
    expect(backup).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(migrationValidate);
    expect(migrationValidate).toBeLessThan(start);
    expect(result.log).toContain(
      "-v " + result.productionRoot + ":/var/lib/gig-finder",
    );
    expect(result.log).toContain("-v " + result.logRoot + ":/var/log/gig-finder");
    expect(result.log).toContain("-v " + result.backupRoot + ":/var/backups/gig-finder");
    expect(result.log).toContain(
      "-v " + result.canonicalConfigFile + ":/etc/gig-finder/config.json:ro",
    );
    expect(result.log).not.toContain("-v " + result.configFile + ":/etc/gig-finder/config.json:ro");
    expect(result.syncLog).toContain(result.productionRoot);
    expect(result.syncLog).toContain("--finalize /var/lib/gig-finder/data/deployment-inputs-test.json");
    expect(result.log).toContain("-v " + path.join(directory, "codex") + ":/run/codex:ro");
    expect(result.stdout + result.stderr).not.toContain(path.join(directory, "codex"));
  });

  test("restarts the prior container when migration fails", async () => {
    const result = await runDeployment({ failure: "migrate", oldContainer: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("migration or validation failed");
    expect(result.log).toContain("stop gig-finder");
    expect(result.log).toContain("maintenance.js restore /var/backups/gig-finder/test.sqlite");
    expect(result.log).toContain("start gig-finder");
    expect(result.log).not.toContain("run --detach");
    expect(result.syncLog).toContain("--rollback /var/lib/gig-finder/data/deployment-inputs-test.json");
  });

  test("restores the backup and prior container when health verification fails", async () => {
    const result = await runDeployment({ failure: "health", oldContainer: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("restoring /var/backups/gig-finder/test.sqlite");
    expect(result.log).toContain("maintenance.js restore /var/backups/gig-finder/test.sqlite");
    expect(result.log).toContain("rename gig-finder-previous-");
    expect(result.log).toContain("start gig-finder");
    expect(result.syncLog).toContain("--rollback /var/lib/gig-finder/data/deployment-inputs-test.json");
  });
});

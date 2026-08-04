import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");
const temporaryRoot = path.join(repositoryRoot, "tmp");
const entrypoint = path.join(repositoryRoot, "src", "entrypoints", "maintenance.ts");
let directory = "";

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(path.join(temporaryRoot, "maintenance-entrypoint-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function run(command: "initialize" | "validate") {
  const child = Bun.spawn(["bun", entrypoint, command], {
    cwd: repositoryRoot,
    env: { ...process.env, GIG_FINDER_CONTEXT_ROOT: directory },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("initialize creates a missing data directory and a valid database", async () => {
  const initialized = await run("initialize");
  expect(initialized.exitCode).toBe(0);
  expect(JSON.parse(initialized.stdout)).toMatchObject({
    command: "initialize",
    ok: true,
  });
  expect(await Bun.file(path.join(directory, "data", "gig-finder.sqlite")).exists()).toBe(true);

  const validated = await run("validate");
  expect(validated.exitCode).toBe(0);
  expect(JSON.parse(validated.stdout)).toMatchObject({
    command: "validate",
    ok: true,
  });
});

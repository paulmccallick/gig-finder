import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { syncProductionInputs } from "../production-inputs";

const temporaryRoot = path.resolve("tmp");
let directory = "";

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(path.join(temporaryRoot, "production-inputs-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("synchronization preserves runtime-owned Scout artifacts", async () => {
  const source = path.join(directory, "source");
  const state = path.join(directory, "state");
  const config = path.join(directory, "config", "config.json");
  const runtimeArtifact = path.join(state, "artifacts", "gig-scout", "descriptions", "aa", "runtime.md");
  await mkdir(path.join(source, "profile"), { recursive: true });
  await mkdir(path.join(source, "artifacts", "gig-scout", "descriptions"), { recursive: true });
  await mkdir(path.dirname(runtimeArtifact), { recursive: true });
  await writeFile(path.join(source, "profile", "candidate-profile.json"), "{}\n");
  await writeFile(path.join(source, "artifacts", "gig-scout", "descriptions", "source.md"), "source\n");
  await writeFile(runtimeArtifact, "runtime\n");

  const result = await syncProductionInputs(source, state, config);

  expect(await readFile(runtimeArtifact, "utf8")).toBe("runtime\n");
  expect(await Bun.file(path.join(state, "artifacts", "gig-scout", "descriptions", "source.md")).exists()).toBe(false);
  expect(result.plan.prohibitedDeletes).toBe(0);
  expect(result.plan.runtimeOwnedRoots).toEqual([path.join(state, "artifacts")]);
});

test("synchronization restores every source-managed input after a partial failure", async () => {
  const source = path.join(directory, "source");
  const state = path.join(directory, "state");
  const config = path.join(directory, "config", "config.json");
  const profile = path.join(state, "profile", "candidate-profile.json");
  const migration = path.join(state, "data", "migration", "0010-meeting-participants.json");
  await mkdir(path.join(source, "profile"), { recursive: true });
  await mkdir(path.dirname(config), { recursive: true });
  await mkdir(path.dirname(profile), { recursive: true });
  await mkdir(path.dirname(migration), { recursive: true });
  await writeFile(path.join(source, "config.json"), '{"version":1,"actor":"New"}\n');
  await writeFile(config, "old config\n");
  await writeFile(profile, "old profile\n");
  await writeFile(migration, "old migration\n");

  await expect(syncProductionInputs(source, state, config)).rejects.toThrow();

  expect(await readFile(config, "utf8")).toBe("old config\n");
  expect(await readFile(profile, "utf8")).toBe("old profile\n");
  expect(await readFile(migration, "utf8")).toBe("old migration\n");
});

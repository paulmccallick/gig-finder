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

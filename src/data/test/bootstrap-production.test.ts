import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bootstrapProduction } from "../../entrypoints/bootstrap-production";
import { migrateDatabase, openDatabase, verifyBackup } from "../src";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");
const temporaryRoot = path.join(repositoryRoot, "tmp");
let directory = "";

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(path.join(temporaryRoot, "bootstrap-production-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("bootstraps an isolated production context from a verified database copy", async () => {
  const applicationRoot = path.join(directory, "repository");
  const sourceRoot = path.join(applicationRoot, "context");
  const productionRoot = path.join(directory, "production");
  const sourceDatabase = path.join(sourceRoot, "data", "gig-finder.sqlite");
  await mkdir(path.dirname(sourceDatabase), { recursive: true });
  await mkdir(path.join(sourceRoot, "profile"), { recursive: true });
  await mkdir(productionRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, "config.json"), '{"version":1,"actor":"Synthetic"}\n');
  await writeFile(path.join(sourceRoot, "profile", "candidate-profile.json"), "{}\n");
  const database = openDatabase(sourceDatabase);
  migrateDatabase(database);
  database.close();

  const result = await bootstrapProduction(sourceRoot, productionRoot, applicationRoot);

  expect(result.bootstrapped).toBe(true);
  expect(result.productionDatabase).toBe(path.join(productionRoot, "data", "gig-finder.sqlite"));
  expect(verifyBackup(result.productionDatabase).validation.ok).toBe(true);
  expect(verifyBackup(result.recoveryBackup).validation.ok).toBe(true);
  expect(result.recordCounts.gigs).toBe(0);
});

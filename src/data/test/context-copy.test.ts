import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyContext } from "../../operations/bootstrap-context";
import { migrateDatabase, openDatabase, verifyBackup } from "..";

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

test("copies an isolated context from a verified database copy", async () => {
  const applicationRoot = path.join(directory, "repository");
  const sourceRoot = path.join(applicationRoot, "context");
  const productionRoot = path.join(directory, "var", "lib", "gig-finder");
  const backupRoot = path.join(directory, "var", "backups", "gig-finder");
  const configFile = path.join(directory, "etc", "gig-finder", "config.json");
  const sourceDatabase = path.join(sourceRoot, "data", "gig-finder.sqlite");
  await mkdir(path.dirname(sourceDatabase), { recursive: true });
  await mkdir(path.join(sourceRoot, "profile"), { recursive: true });
  await mkdir(path.join(sourceRoot, "artifacts", "gigs", "example"), { recursive: true });
  await mkdir(path.join(sourceRoot, "data", "migration", "replay"), { recursive: true });
  await mkdir(productionRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await mkdir(path.dirname(configFile), { recursive: true });
  await writeFile(
    path.join(sourceRoot, "config.json"),
    '{"version":1,"actor":"Synthetic","profile":"profile/candidate-profile.json"}\n',
  );
  await writeFile(path.join(sourceRoot, "profile", "candidate-profile.json"), "{}\n");
  await writeFile(path.join(sourceRoot, "profile", "existing-document.md"), "document\n");
  await writeFile(
    path.join(sourceRoot, "artifacts", "gigs", "example", "job-description.md"),
    "description\n",
  );
  await writeFile(
    path.join(sourceRoot, "data", "migration", "0010-meeting-participants.json"),
    "{}\n",
  );
  await writeFile(path.join(sourceRoot, "data", "migration", "replay", "large.json"), "skip\n");
  const database = openDatabase(sourceDatabase);
  migrateDatabase(database);
  database.close();

  const result = await copyContext(sourceRoot, productionRoot, applicationRoot, {
    backupRoot,
    configFile,
  });

  expect(result.copied).toBe(true);
  expect(result.targetDatabase).toBe(path.join(productionRoot, "data", "gig-finder.sqlite"));
  expect(verifyBackup(result.targetDatabase).validation.ok).toBe(true);
  expect(verifyBackup(result.recoveryBackup).validation.ok).toBe(true);
  expect(result.recoveryBackup.startsWith(backupRoot)).toBe(true);
  expect(await readFile(configFile, "utf8")).toContain('"actor":"Synthetic"');
  expect(await readFile(path.join(productionRoot, "profile", "existing-document.md"), "utf8"))
    .toBe("document\n");
  expect(await readFile(
    path.join(productionRoot, "artifacts", "gigs", "example", "job-description.md"),
    "utf8",
  )).toBe("description\n");
  expect(await Bun.file(
    path.join(productionRoot, "data", "migration", "0010-meeting-participants.json"),
  ).exists()).toBe(true);
  expect(await Bun.file(path.join(productionRoot, "data", "migration", "replay")).exists())
    .toBe(false);
  expect(result.recordCounts.gigs).toBe(0);
});

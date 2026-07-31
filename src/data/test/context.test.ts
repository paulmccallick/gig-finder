import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveGigFinderContext } from "../src/context";
import { listManagedBackups } from "../src/maintenance";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("uses GigFinder context names for a new workspace", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "gig-finder-context-"));
  const context = resolveGigFinderContext(directory, {});

  expect(context.database).toBe(path.join(directory, "context/data/gig-finder.sqlite"));
  expect(context.profile).toBe(path.join(directory, "context/profile/candidate-profile.json"));
});

test("discovers legacy private context without moving it", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "gig-finder-context-"));
  const root = path.join(directory, "private-context");
  const profile = path.join(root, "profile/job-search-profile.json");
  const database = path.join(root, "data/job-search.sqlite");
  await mkdir(path.dirname(profile), { recursive: true });
  await mkdir(path.dirname(database), { recursive: true });
  await writeFile(profile, "{}");
  await writeFile(database, "legacy");

  const context = resolveGigFinderContext(directory, { JOB_SEARCH_CONTEXT_ROOT: root });

  expect(context.root).toBe(root);
  expect(context.profile).toBe(profile);
  expect(context.database).toBe(database);
});

test("ignores an empty new database file when a legacy database exists", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "gig-finder-context-"));
  const data = path.join(directory, "context/data");
  const legacy = path.join(data, "job-search.sqlite");
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, "gig-finder.sqlite"), "");
  await writeFile(legacy, "legacy");

  expect(resolveGigFinderContext(directory, {}).database).toBe(legacy);
});

test("recognizes legacy and GigFinder managed backup names", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "gig-finder-backups-"));
  const legacy = "job-search-2026-07-30T10-00-00-000Z.sqlite";
  const current = "gig-finder-2026-07-31T10-00-00-000Z.sqlite";
  await Promise.all([
    writeFile(path.join(directory, legacy), "legacy"),
    writeFile(path.join(directory, current), "current"),
    writeFile(path.join(directory, "other.sqlite"), "other"),
  ]);

  expect(await listManagedBackups(directory)).toEqual([
    path.join(directory, legacy),
    path.join(directory, current),
  ]);
});

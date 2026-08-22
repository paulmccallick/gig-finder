import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDatabase } from "../database";
import { hasRuntimeArtifactRegression, verifyRuntimeArtifacts } from "../runtime-artifacts";

const temporaryRoot = path.resolve("tmp");
let directory = "";

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(path.join(temporaryRoot, "runtime-artifacts-"));
});

test("allows known damage but rejects a newly worse artifact inventory", () => {
  const baseline = { ok: false, registered: 3, present: 1, missing: 2, hashMismatched: 0, unsafe: 0, unregistered: 0, missingFingerprint: "same", hashMismatchedFingerprint: "same", unsafeFingerprint: "same", unregisteredFingerprint: "same" };
  expect(hasRuntimeArtifactRegression(baseline, { ...baseline, present: 2, missing: 1 })).toBe(false);
  expect(hasRuntimeArtifactRegression(baseline, { ...baseline, missing: 3 })).toBe(true);
  expect(hasRuntimeArtifactRegression(baseline, { ...baseline, unregistered: 1 })).toBe(true);
  expect(hasRuntimeArtifactRegression(baseline, { ...baseline, missingFingerprint: "different" })).toBe(true);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("reports Scout artifact integrity without exposing contents", async () => {
  const database = openDatabase(path.join(directory, "database.sqlite"));
  const descriptions = path.join(directory, "artifacts", "gig-scout", "descriptions");
  const content = "synthetic description\n";
  const hash = createHash("sha256").update(content).digest("hex");
  await mkdir(path.join(descriptions, "aa"), { recursive: true });
  await writeFile(path.join(descriptions, "aa", "present.md"), content);
  await writeFile(path.join(descriptions, "unregistered.md"), "extra\n");
  database.exec("CREATE TABLE scout_description_artifacts(file_path text, content_hash text, byte_count integer)");
  database.query("INSERT INTO scout_description_artifacts VALUES (?, ?, ?)").run("aa/present.md", hash, Buffer.byteLength(content));
  database.query("INSERT INTO scout_description_artifacts VALUES (?, ?, ?)").run("missing.md", hash, Buffer.byteLength(content));
  database.query("INSERT INTO scout_description_artifacts VALUES (?, ?, ?)").run("../unsafe.md", hash, Buffer.byteLength(content));

  expect(await verifyRuntimeArtifacts(database, descriptions)).toEqual(expect.objectContaining({
    ok: false,
    registered: 3,
    present: 1,
    missing: 1,
    hashMismatched: 0,
    unsafe: 1,
    unregistered: 1,
  }));
  database.close();
});

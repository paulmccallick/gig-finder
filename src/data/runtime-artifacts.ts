import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface RuntimeArtifactIntegrity {
  ok: boolean;
  registered: number;
  present: number;
  missing: number;
  hashMismatched: number;
  unsafe: number;
  unregistered: number;
  missingFingerprint: string;
  hashMismatchedFingerprint: string;
  unsafeFingerprint: string;
  unregisteredFingerprint: string;
  missingPathHashes: string[];
  hashMismatchedPathHashes: string[];
  unsafePathHashes: string[];
  unregisteredPathHashes: string[];
}

const fingerprint = (values: string[]) => createHash("sha256")
  .update(values.sort().join("\n"))
  .digest("hex");
const pathHashes = (values: string[]) => values
  .map((value) => createHash("sha256").update(value).digest("hex"))
  .sort();
const introducesPath = (baseline: string[], current: string[]) => {
  const known = new Set(baseline);
  return current.some((value) => !known.has(value));
};

export function hasRuntimeArtifactRegression(
  baseline: RuntimeArtifactIntegrity,
  current: RuntimeArtifactIntegrity,
) {
  return current.missing > baseline.missing
    || current.hashMismatched > baseline.hashMismatched
    || current.unsafe > baseline.unsafe
    || current.unregistered > baseline.unregistered
    || introducesPath(baseline.missingPathHashes, current.missingPathHashes)
    || introducesPath(baseline.hashMismatchedPathHashes, current.hashMismatchedPathHashes)
    || introducesPath(baseline.unsafePathHashes, current.unsafePathHashes)
    || introducesPath(baseline.unregisteredPathHashes, current.unregisteredPathHashes);
}

interface RegisteredArtifact {
  filePath: string;
  contentHash: string;
  byteCount: number;
}

function safeRelativePath(value: string) {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

async function filesBelow(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function verifyRuntimeArtifacts(
  database: Database,
  scoutDescriptionsRoot: string,
): Promise<RuntimeArtifactIntegrity> {
  const table = database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='scout_description_artifacts'",
  ).get();
  const registered = table
    ? database.query(
      "SELECT file_path filePath, content_hash contentHash, byte_count byteCount FROM scout_description_artifacts ORDER BY file_path",
    ).all() as RegisteredArtifact[]
    : [];
  const registeredPaths = new Set<string>();
  let present = 0;
  let missing = 0;
  let hashMismatched = 0;
  let unsafe = 0;
  const missingPaths: string[] = [];
  const mismatchedPaths: string[] = [];
  const unsafePaths: string[] = [];

  for (const artifact of registered) {
    if (!safeRelativePath(artifact.filePath)) {
      unsafe += 1;
      unsafePaths.push(artifact.filePath);
      continue;
    }
    registeredPaths.add(path.normalize(artifact.filePath));
    const filename = path.join(scoutDescriptionsRoot, artifact.filePath);
    const info = await lstat(filename).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (!info || !info.isFile()) {
      missing += 1;
      missingPaths.push(artifact.filePath);
      continue;
    }
    const contents = await readFile(filename);
    const hash = createHash("sha256").update(contents).digest("hex");
    if (contents.byteLength !== artifact.byteCount || hash !== artifact.contentHash) {
      hashMismatched += 1;
      mismatchedPaths.push(artifact.filePath);
      continue;
    }
    present += 1;
  }

  const diskFiles = await filesBelow(scoutDescriptionsRoot);
  const unregisteredPaths = diskFiles.filter((filename) => !registeredPaths.has(path.normalize(filename)));
  const unregistered = unregisteredPaths.length;
  return {
    ok: missing === 0 && hashMismatched === 0 && unsafe === 0,
    registered: registered.length,
    present,
    missing,
    hashMismatched,
    unsafe,
    unregistered,
    missingFingerprint: fingerprint(missingPaths),
    hashMismatchedFingerprint: fingerprint(mismatchedPaths),
    unsafeFingerprint: fingerprint(unsafePaths),
    unregisteredFingerprint: fingerprint(unregisteredPaths),
    missingPathHashes: pathHashes(missingPaths),
    hashMismatchedPathHashes: pathHashes(mismatchedPaths),
    unsafePathHashes: pathHashes(unsafePaths),
    unregisteredPathHashes: pathHashes(unregisteredPaths),
  };
}

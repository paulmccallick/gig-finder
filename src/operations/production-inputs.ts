import path from "node:path";
import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolveGigFinderContext } from "../data";

const repositoryRoot = path.resolve(import.meta.dir, "../..");

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requireDescendant(root: string, filename: string, label: string) {
  const relative = path.relative(root, filename);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must be inside the source context.`);
  }
  return relative;
}

async function copyFileAtomically(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.deploy-${process.pid}-${Date.now()}`;
  try {
    await cp(source, temporary, { errorOnExist: true, force: false });
    const existing = await stat(target).catch((error) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (existing) await chmod(temporary, existing.mode);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

interface InputBackup { target: string; backup: string; existed: boolean }

async function snapshotInputs(targets: string[]) {
  const suffix = `${process.pid}-${Date.now()}`;
  const backups: InputBackup[] = [];
  try {
    for (const target of targets) {
      const backup = `${target}.deploy-backup-${suffix}`;
      const info = await stat(target).catch((error) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (info && !info.isFile()) throw new Error(`Production input target must be a regular file: ${target}`);
      if (info) await cp(target, backup, { errorOnExist: true, force: false });
      backups.push({ target, backup, existed: Boolean(info) });
    }
    return backups;
  } catch (error) {
    await Promise.all(backups.map(({ backup }) => rm(backup, { force: true })));
    throw error;
  }
}

async function restoreInputs(backups: InputBackup[]) {
  const failures: unknown[] = [];
  for (const { target, backup, existed } of [...backups].reverse()) {
    try {
      if (existed) await rename(backup, target);
      else await rm(target, { force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Production input rollback failed; recovery copies were retained.");
}

async function readInputManifest(manifestPath: string) {
  if (!path.isAbsolute(manifestPath)) throw new Error("Production input transaction manifest must be absolute.");
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as { version: number; backups: InputBackup[] };
  if (parsed.version !== 1 || !Array.isArray(parsed.backups)) throw new Error("Invalid production input transaction manifest.");
  return parsed.backups;
}

export async function finalizeProductionInputs(manifestPath: string) {
  const backups = await readInputManifest(manifestPath);
  await Promise.all(backups.map(({ backup }) => rm(backup, { force: true })));
  await rm(manifestPath);
}

export async function rollbackProductionInputs(manifestPath: string) {
  const backups = await readInputManifest(manifestPath);
  await restoreInputs(backups);
  await Promise.all(backups.map(({ backup }) => rm(backup, { force: true })));
  await rm(manifestPath);
}

export async function syncProductionInputs(
  sourceRootArgument: string,
  stateRootArgument: string,
  configFileArgument: string,
  applicationRoot = repositoryRoot,
) {
  if (![sourceRootArgument, stateRootArgument, configFileArgument].every(path.isAbsolute)) {
    throw new Error("Production input paths must be absolute.");
  }
  const sourceRoot = await realpath(path.resolve(sourceRootArgument));
  const stateRoot = await realpath(path.resolve(stateRootArgument));
  if (sourceRoot === stateRoot) throw new Error("Source and production state roots must differ.");

  const source = resolveGigFinderContext(applicationRoot, {
    GIG_FINDER_CONTEXT_ROOT: sourceRoot,
  });
  const profileRelative = requireDescendant(sourceRoot, source.profile, "Profile");
  const configSource = path.join(sourceRoot, "config.json");
  const configTarget = path.resolve(configFileArgument);

  const migrationRelative = path.join("data", "migration", "0010-meeting-participants.json");
  const migrationSource = path.join(sourceRoot, migrationRelative);
  const profileTarget = path.join(stateRoot, profileRelative);
  const migrationTarget = path.join(stateRoot, migrationRelative);
  const backups = await snapshotInputs([configTarget, profileTarget, migrationTarget]);
  try {
    try {
      await stat(configSource);
      await copyFileAtomically(configSource, configTarget);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(path.dirname(configTarget), { recursive: true });
      await writeFile(configTarget, `${JSON.stringify({
        version: 1,
        actor: source.actor,
        profile: profileRelative,
      }, null, 2)}\n`);
    }
    await copyFileAtomically(source.profile, profileTarget);
    try {
      await stat(migrationSource);
      await copyFileAtomically(migrationSource, migrationTarget);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  } catch (error) {
    try {
      await restoreInputs(backups);
      await Promise.all(backups.map(({ backup }) => rm(backup, { force: true })));
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Production input synchronization and rollback failed.",
        { cause: rollbackError },
      );
    }
    throw error;
  }
  const transactionManifest = path.join(stateRoot, "data", `deployment-inputs-${randomUUID()}.json`);
  await mkdir(path.dirname(transactionManifest), { recursive: true });
  await writeFile(transactionManifest, `${JSON.stringify({ version: 1, backups }, null, 2)}\n`, { flag: "wx", mode: 0o600 });

  return {
    profile: path.join(stateRoot, profileRelative),
    config: configTarget,
    plan: {
      createsOrReplaces: [configTarget, path.join(stateRoot, profileRelative)],
      runtimeOwnedRoots: [path.join(stateRoot, "artifacts")],
      prohibitedDeletes: 0,
      transactionManifest,
    },
  };
}

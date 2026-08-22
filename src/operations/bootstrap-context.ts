import path from "node:path";
import { cp, mkdir, realpath, stat } from "node:fs/promises";
import {
  createManagedBackup,
  createVerifiedBackup,
  resolveGigFinderContext,
  verifyBackup,
} from "../data";
import { syncProductionInputs } from "./production-inputs";

const repositoryRoot = path.resolve(import.meta.dir, "../..");

export async function copyContext(
  sourceRootArgument: string,
  targetRootArgument: string,
  applicationRoot = repositoryRoot,
  locations: { backupRoot?: string; configFile?: string } = {},
) {
  if (!path.isAbsolute(sourceRootArgument) || !path.isAbsolute(targetRootArgument)) {
    throw new Error("Source and target context roots must be absolute.");
  }
  const sourceRoot = await realpath(path.resolve(sourceRootArgument));
  let targetRoot: string;
  try {
    targetRoot = await realpath(path.resolve(targetRootArgument));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Target context root must exist before copying.", {
        cause: error,
      });
    }
    throw error;
  }
  if (sourceRoot === targetRoot) {
    throw new Error("Source and target context roots must be different.");
  }
  const source = resolveGigFinderContext(applicationRoot, {
    GIG_FINDER_CONTEXT_ROOT: sourceRoot,
  });
  const targetDatabase = path.join(targetRoot, "data", "gig-finder.sqlite");
  try {
    await stat(targetDatabase);
    throw new Error(`Target database already exists: ${targetDatabase}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  await mkdir(path.dirname(targetDatabase), { recursive: true });
  const backupRoot = path.resolve(locations.backupRoot ?? path.join(targetRoot, "backups"));
  const configFile = path.resolve(locations.configFile ?? path.join(targetRoot, "config.json"));
  await mkdir(backupRoot, { recursive: true });
  for (const relative of ["profile"]) {
    const sourcePath = path.join(sourceRoot, relative);
    try {
      await stat(sourcePath);
      await cp(sourcePath, path.join(targetRoot, relative), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  const recoveryBackup = await createManagedBackup(
    source.database,
    backupRoot,
  );
  const database = await createVerifiedBackup(source.database, targetDatabase);
  try {
    await stat(source.artifacts);
    await cp(source.artifacts, path.join(targetRoot, "artifacts"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const inputs = await syncProductionInputs(
    sourceRoot,
    targetRoot,
    configFile,
    applicationRoot,
  );
  const verified = verifyBackup(targetDatabase);
  return {
    copied: true as const,
    sourceDatabase: source.database,
    targetDatabase,
    recoveryBackup: recoveryBackup.path,
    inputs,
    database,
    recordCounts: verified.validation.counts,
  };
}

if (import.meta.main) {
  const [sourceRootArgument, targetRootArgument, backupRoot, configFile] = process.argv.slice(2);
  if (!sourceRootArgument || !targetRootArgument || !backupRoot || !configFile) {
    throw new Error(
      "Usage: bootstrap-context <source-context-root> <state-root> <backup-root> <config-file>",
    );
  }
  console.log(JSON.stringify(
    await copyContext(sourceRootArgument, targetRootArgument, repositoryRoot, {
      backupRoot,
      configFile,
    }),
    null,
    2,
  ));
}

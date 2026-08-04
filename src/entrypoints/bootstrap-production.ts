import path from "node:path";
import { cp, mkdir, realpath, stat } from "node:fs/promises";
import {
  createManagedBackup,
  createVerifiedBackup,
  resolveGigFinderContext,
  verifyBackup,
} from "../data/src";

const repositoryRoot = path.resolve(import.meta.dir, "../..");

export async function bootstrapProduction(
  sourceRootArgument: string,
  productionRootArgument: string,
  applicationRoot = repositoryRoot,
) {
  if (!path.isAbsolute(sourceRootArgument) || !path.isAbsolute(productionRootArgument)) {
    throw new Error("Source and production context roots must be absolute.");
  }
  const sourceRoot = await realpath(path.resolve(sourceRootArgument));
  let productionRoot: string;
  try {
    productionRoot = await realpath(path.resolve(productionRootArgument));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Production context root must exist before bootstrapping.", {
        cause: error,
      });
    }
    throw error;
  }
  const relativeProduction = path.relative(path.resolve(applicationRoot), productionRoot);
  if (relativeProduction === "" || (!relativeProduction.startsWith(`..${path.sep}`) && relativeProduction !== "..")) {
    throw new Error("Production context root must be outside the repository.");
  }
  const source = resolveGigFinderContext(applicationRoot, {
    GIG_FINDER_CONTEXT_ROOT: sourceRoot,
  });
  const targetDatabase = path.join(productionRoot, "data", "gig-finder.sqlite");
  try {
    await stat(targetDatabase);
    throw new Error(`Production database already exists: ${targetDatabase}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  await mkdir(path.dirname(targetDatabase), { recursive: true });
  await mkdir(path.join(productionRoot, "backups"), { recursive: true });
  for (const relative of ["config.json", "profile", "artifacts", path.join("data", "migration")]) {
    const sourcePath = path.join(sourceRoot, relative);
    try {
      await stat(sourcePath);
      await cp(sourcePath, path.join(productionRoot, relative), {
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
    path.join(productionRoot, "backups"),
  );
  const database = await createVerifiedBackup(source.database, targetDatabase);
  const verified = verifyBackup(targetDatabase);
  return {
    bootstrapped: true as const,
    sourceDatabase: source.database,
    productionDatabase: targetDatabase,
    recoveryBackup: recoveryBackup.path,
    database,
    recordCounts: verified.validation.counts,
  };
}

if (import.meta.main) {
  const [sourceRootArgument, productionRootArgument] = process.argv.slice(2);
  if (!sourceRootArgument || !productionRootArgument) {
    throw new Error("Usage: bootstrap-production <source-context-root> <production-context-root>");
  }
  console.log(JSON.stringify(
    await bootstrapProduction(sourceRootArgument, productionRootArgument),
    null,
    2,
  ));
}

import path from "node:path";
import { cp, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
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
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
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

  await copyFileAtomically(source.profile, path.join(stateRoot, profileRelative));

  const migrationRelative = path.join("data", "migration", "0010-meeting-participants.json");
  const migrationSource = path.join(sourceRoot, migrationRelative);
  try {
    await stat(migrationSource);
    await copyFileAtomically(migrationSource, path.join(stateRoot, migrationRelative));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  return {
    profile: path.join(stateRoot, profileRelative),
    config: configTarget,
    plan: {
      createsOrReplaces: [configTarget, path.join(stateRoot, profileRelative)],
      runtimeOwnedRoots: [path.join(stateRoot, "artifacts")],
      prohibitedDeletes: 0,
    },
  };
}

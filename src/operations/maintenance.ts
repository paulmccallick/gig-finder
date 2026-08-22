import path from "node:path";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  createManagedBackup,
  hasRuntimeArtifactRegression,
  loadLegacyMeetingParticipants,
  migrateLegacyGigArtifacts,
  migrateDatabase,
  openDatabase,
  resolveGigFinderContext,
  restoreVerifiedBackup,
  validateDatabase,
  verifyRuntimeArtifacts,
} from "../data";

const repoRoot = path.resolve(import.meta.dir, "../..");
const context = resolveGigFinderContext(repoRoot);
const [command, argument] = process.argv.slice(2);

const output = (value: unknown) => console.log(JSON.stringify(value));

const artifactSnapshotPath = (databaseBackupPath: string) => `${databaseBackupPath}.artifacts`;
const stateManifestPath = (databaseBackupPath: string) => `${databaseBackupPath}.state.json`;

async function artifactIntegrity() {
  const database = openDatabase(context.database, { create: false });
  try {
    return await verifyRuntimeArtifacts(database, context.scoutDescriptions);
  } finally {
    database.close();
  }
}

async function createArtifactSnapshot(databaseBackupPath: string) {
  const integrity = await artifactIntegrity();
  const target = artifactSnapshotPath(databaseBackupPath);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await cp(context.artifacts, temporary, { recursive: true, errorOnExist: true, force: false });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const backupDatabase = openDatabase(databaseBackupPath, { create: false });
  let snapshotIntegrity;
  try {
    snapshotIntegrity = await verifyRuntimeArtifacts(
      backupDatabase,
      path.join(target, "gig-scout", "descriptions"),
    );
  } finally {
    backupDatabase.close();
  }
  if (JSON.stringify(snapshotIntegrity) !== JSON.stringify(integrity)) {
    await rm(target, { recursive: true, force: true });
    throw new Error("Artifact snapshot does not match the pre-backup integrity inventory.");
  }
  const manifest = { version: 1, databaseBackupPath, artifactSnapshotPath: target, integrity: snapshotIntegrity };
  await writeFile(stateManifestPath(databaseBackupPath), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { path: target, integrity: snapshotIntegrity };
}

async function activateArtifactSnapshot(databaseBackupPath: string) {
  const source = artifactSnapshotPath(databaseBackupPath);
  const manifest = JSON.parse(await readFile(stateManifestPath(databaseBackupPath), "utf8")) as {
    version: number;
    artifactSnapshotPath: string;
    integrity: unknown;
  };
  if (manifest.version !== 1 || manifest.artifactSnapshotPath !== source) {
    throw new Error("Backup state manifest does not match the requested database backup.");
  }
  const temporary = `${context.artifacts}.restore-${process.pid}-${Date.now()}`;
  const displaced = `${context.artifacts}.pre-restore-${process.pid}-${Date.now()}`;
  await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
  const backupDatabase = openDatabase(databaseBackupPath, { create: false });
  try {
    const staged = await verifyRuntimeArtifacts(
      backupDatabase,
      path.join(temporary, "gig-scout", "descriptions"),
    );
    if (JSON.stringify(staged) !== JSON.stringify(manifest.integrity)) {
      throw new Error("Staged runtime artifacts do not match the backup state manifest.");
    }
  } finally {
    backupDatabase.close();
  }
  await rename(context.artifacts, displaced);
  try {
    await rename(temporary, context.artifacts);
  } catch (error) {
    await rename(displaced, context.artifacts);
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    finalize: () => rm(displaced, { recursive: true, force: true }),
    rollback: async () => {
      await rm(context.artifacts, { recursive: true, force: true });
      await rename(displaced, context.artifacts);
    },
  };
}

if (command === "backup") {
  const backup = await createManagedBackup(context.database, context.backups);
  const artifacts = await createArtifactSnapshot(backup.path);
  output({ command, ok: true, backup, artifacts });
} else if (command === "migrate" || command === "initialize") {
  if (command === "initialize") {
    await mkdir(path.dirname(context.database), { recursive: true });
  }
  const database = openDatabase(context.database, { create: command === "initialize" });
  try {
    migrateDatabase(database, {
      legacyMeetingParticipants: loadLegacyMeetingParticipants(
        context.meetingParticipantMigration,
      ),
    });
    const legacyArtifacts = await migrateLegacyGigArtifacts(database, context.artifacts);
    const validation = validateDatabase(database);
    output({ command, ok: validation.ok, validation, legacyArtifacts });
    if (!validation.ok) process.exitCode = 1;
  } finally {
    database.close();
  }
} else if (command === "validate") {
  const database = openDatabase(context.database, { create: false });
  try {
    const validation = validateDatabase(database);
    const artifacts = await verifyRuntimeArtifacts(database, context.scoutDescriptions);
    output({ command, ok: validation.ok, validation, artifacts });
    if (!validation.ok) process.exitCode = 1;
  } finally {
    database.close();
  }
} else if (command === "restore") {
  if (!argument || !path.isAbsolute(argument)) {
    throw new Error("restore requires an absolute managed-backup path.");
  }
  const activatedArtifacts = await activateArtifactSnapshot(argument);
  let preRestoreDatabase: string | null = null;
  try {
    const restored = await restoreVerifiedBackup(
      context.database,
      argument,
      context.backups,
    );
    preRestoreDatabase = restored.preRestore.path;
    const artifacts = await artifactIntegrity();
    const manifest = JSON.parse(await readFile(stateManifestPath(argument), "utf8")) as {
      integrity: unknown;
    };
    if (JSON.stringify(artifacts) !== JSON.stringify(manifest.integrity)) {
      throw new Error("Restored runtime artifact inventory does not match its backup manifest.");
    }
    await activatedArtifacts.finalize();
    output({ command, ok: true, ...restored, artifacts });
  } catch (error) {
    if (preRestoreDatabase) {
      await restoreVerifiedBackup(context.database, preRestoreDatabase, context.backups);
    }
    await activatedArtifacts.rollback();
    throw error;
  }
} else if (command === "artifacts") {
  const artifacts = await artifactIntegrity();
  if (argument) {
    const parsed = JSON.parse(argument) as typeof artifacts | { artifacts: typeof artifacts };
    const baseline = "artifacts" in parsed ? parsed.artifacts : parsed;
    const regression = hasRuntimeArtifactRegression(baseline, artifacts);
    output({ command, ok: !regression, artifacts, baseline });
    if (regression) process.exitCode = 1;
  } else {
    output({ command, ok: true, artifacts });
  }
} else {
  throw new Error("Usage: maintenance <artifacts|backup|initialize|migrate|validate|restore> [argument]");
}

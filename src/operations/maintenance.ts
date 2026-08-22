import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  createManagedBackup,
  hasRuntimeArtifactRegression,
  loadLegacyMeetingParticipants,
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

async function artifactIntegrity() {
  const database = openDatabase(context.database, { create: false });
  try {
    return await verifyRuntimeArtifacts(database, context.scoutDescriptions);
  } finally {
    database.close();
  }
}

if (command === "backup") {
  const backup = await createManagedBackup(context.database, context.backups);
  output({ command, ok: true, backup });
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
    const validation = validateDatabase(database);
    output({ command, ok: validation.ok, validation });
    if (!validation.ok) process.exitCode = 1;
  } finally {
    database.close();
  }
} else if (command === "validate") {
  const database = openDatabase(context.database, { create: false });
  try {
    const validation = validateDatabase(database);
    output({ command, ok: validation.ok, validation });
    if (!validation.ok) process.exitCode = 1;
  } finally {
    database.close();
  }
} else if (command === "restore") {
  if (!argument || !path.isAbsolute(argument)) {
    throw new Error("restore requires an absolute managed-backup path.");
  }
  const restored = await restoreVerifiedBackup(context.database, argument, context.backups);
  output({ command, ok: true, ...restored });
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

import path from "node:path";
import {
  createManagedBackup,
  loadLegacyMeetingParticipants,
  migrateLegacyGigArtifacts,
  migrateDatabase,
  openDatabase,
  resolveGigFinderContext,
  validateDatabase,
} from "../data";

const repoRoot = path.resolve(import.meta.dir, "../..");
const context = resolveGigFinderContext(repoRoot);
const backup = await createManagedBackup(context.database, context.backups);
const database = openDatabase(context.database, { create: false });
let interactionMigration:unknown=null;

try {
  migrateDatabase(database, {
    legacyMeetingParticipants: loadLegacyMeetingParticipants(
      context.meetingParticipantMigration,
    ),
    unresolvedBusinessEventsCsv:context.unresolvedBusinessEventsCsv,
    businessEventReviewCsv:context.businessEventReviewCsv,
    requireBusinessEventReview:context.requireBusinessEventReview,
    onInteractionMigrationReport:report=>{interactionMigration=report},
  });
  const legacyArtifacts = await migrateLegacyGigArtifacts(database, context.artifacts);
  const validation = validateDatabase(database);
  if (!validation.ok) {
    throw new Error(
      `Database validation failed after migration: ${validation.issues.map(issue => issue.message).join("; ")}`,
    );
  }
  console.log(JSON.stringify({
    migrated: true,
    backup: backup.path,
    integrity: validation.integrity,
    foreignKeyViolations: validation.foreignKeyViolations,
    legacyArtifacts,
    interactionMigration,
  }, null, 2));
} finally {
  database.close();
}

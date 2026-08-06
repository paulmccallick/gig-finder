import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import type { LegacyMeetingParticipant } from "./meeting-migration";
import { completeInteractionMigrationReport, prepareInteractionMigration, type InteractionMigrationReport } from "./interaction-migration";

export const migrationsFolder = path.resolve(import.meta.dir, "migrations");

export function openDatabase(filename: string, options: { create?: boolean } = {}): Database {
  const database = new Database(filename, { create: options.create ?? true, strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

export interface DatabaseMigrationOptions {
  legacyMeetingParticipants?: readonly LegacyMeetingParticipant[];
  unresolvedBusinessEventsCsv?: string;
  businessEventReviewCsv?: string;
  requireBusinessEventReview?: boolean;
  onInteractionMigrationReport?: (report:InteractionMigrationReport)=>void;
}

function hasColumn(database: Database, table: string, column: string) {
  return (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some(item => item.name === column);
}

function prepareLegacyMeetingParticipantBackfill(
  database: Database,
  participants: readonly LegacyMeetingParticipant[],
) {
  if (!hasColumn(database, "meetings", "related_entity_type")) return false;
  const prepare = database.transaction(() => {
    database.exec("DROP TABLE IF EXISTS meeting_participant_backfill");
    database.exec(`
      CREATE TABLE meeting_participant_backfill (
        meeting_id text NOT NULL,
        person_id text NOT NULL,
        PRIMARY KEY (meeting_id, person_id)
      )
    `);
    database.exec(`
      INSERT OR IGNORE INTO meeting_participant_backfill (meeting_id, person_id)
      SELECT meetings.id, networking_contacts.person_id
      FROM meetings
      JOIN networking_contacts
        ON meetings.related_entity_type = 'contact'
        AND meetings.related_entity_id = networking_contacts.id
    `);
    database.exec(`
      INSERT OR IGNORE INTO meeting_participant_backfill (meeting_id, person_id)
      SELECT meetings.id, people.id
      FROM meetings
      JOIN people
        ON meetings.related_entity_type = 'person'
        AND meetings.related_entity_id = people.id
    `);
    const insert = database.query(
      "INSERT OR IGNORE INTO meeting_participant_backfill (meeting_id, person_id) VALUES (?, ?)",
    );
    participants.forEach(({ meetingId, personId }, index) => {
      if (!database.query("SELECT 1 FROM meetings WHERE id = ?").get(meetingId)) {
        throw new Error(`Meeting participant migration entry ${index + 1} references an unknown meeting.`);
      }
      if (!database.query("SELECT 1 FROM people WHERE id = ? AND is_deleted = 0").get(personId)) {
        throw new Error(`Meeting participant migration entry ${index + 1} references a missing or deleted person.`);
      }
      insert.run(meetingId, personId);
    });
    const missing = database.query(`
      SELECT count(*) AS count
      FROM meetings
      WHERE NOT EXISTS (
          SELECT 1 FROM meeting_participant_backfill
          WHERE meeting_id = meetings.id
        )
    `).get() as { count: number };
    if (missing.count > 0) {
      throw new Error(
        `Meeting participant migration requires mappings for ${missing.count} meeting(s).`,
      );
    }
  });
  prepare();
  return true;
}

export function migrateDatabase(
  database: Database,
  options: DatabaseMigrationOptions = {},
): void {
  const preparedMeetingBackfill = prepareLegacyMeetingParticipantBackfill(
    database,
    options.legacyMeetingParticipants ?? [],
  );
  const report=prepareInteractionMigration(database,options.unresolvedBusinessEventsCsv??path.resolve("tmp/unresolved-business-events.csv"),options.businessEventReviewCsv,options.requireBusinessEventReview);
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    migrate(drizzle(database), { migrationsFolder });
    if(report)options.onInteractionMigrationReport?.(completeInteractionMigrationReport(database,report));
  } catch (error) {
    if (preparedMeetingBackfill) {
      database.exec("DROP TABLE IF EXISTS meeting_participant_backfill");
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

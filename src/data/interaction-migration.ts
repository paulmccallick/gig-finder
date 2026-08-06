import type { Database } from "bun:sqlite";

export interface InteractionMigrationReport {
  meetings: number;
  meetingHistory: number;
  meetingParticipants: number;
  meetingParticipantHistory: number;
  personLastContacts: number;
  expectedInteractions: number;
  expectedSources: number;
  importedInteractions: number;
  importedSources: number;
  duplicates: number;
}

function tableExists(database: Database, name: string) {
  return Boolean(database.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
}

function createEmptyPreparation(database: Database) {
  database.exec(`
    DROP TABLE IF EXISTS temp.interaction_person_contacts;
    CREATE TEMP TABLE interaction_person_contacts (
      source_key text,
      person_id text,
      name text,
      last_contacted text,
      last_contact_method text,
      last_contact_summary text,
      revision integer,
      origin_change_id text,
      recorded_at text
    );
    DROP TABLE IF EXISTS temp.interaction_migration_expected;
    CREATE TEMP TABLE interaction_migration_expected (
      meetings integer,
      meeting_history integer,
      meeting_participants integer,
      meeting_participant_history integer,
      person_imports integer,
      expected_interactions integer,
      expected_sources integer
    );
    INSERT INTO interaction_migration_expected VALUES (0, 0, 0, 0, 0, 0, 0);
  `);
}

export function prepareInteractionMigration(
  database: Database,
): InteractionMigrationReport | null {
  if (tableExists(database, "interactions")) return null;
  if (!tableExists(database, "meetings")) {
    createEmptyPreparation(database);
    return null;
  }

  database.exec(`
    DROP TABLE IF EXISTS temp.interaction_person_contacts;
    CREATE TEMP TABLE interaction_person_contacts AS
    WITH snapshots AS (
      SELECT
        'current:' || people.id AS source_key,
        people.id AS person_id,
        people.name,
        people.last_contacted,
        people.last_contact_method,
        people.last_contact_summary,
        people.revision,
        NULL AS origin_change_id,
        people.updated_at AS recorded_at
      FROM people
      WHERE people.last_contacted IS NOT NULL
      UNION ALL
      SELECT
        'history:' || person_history.history_id,
        person_history.id,
        person_history.name,
        person_history.last_contacted,
        person_history.last_contact_method,
        person_history.last_contact_summary,
        person_history.revision,
        person_history.change_id,
        person_history.recorded_at
      FROM person_history
      JOIN people ON people.id = person_history.id AND people.is_deleted = 0
      WHERE person_history.last_contacted IS NOT NULL
    ), ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY person_id, last_contacted,
          coalesce(last_contact_method, ''), coalesce(last_contact_summary, '')
        ORDER BY CASE WHEN origin_change_id IS NULL THEN 0 ELSE 1 END, revision DESC
      ) AS rank
      FROM snapshots
    )
    SELECT source_key, person_id, name, last_contacted, last_contact_method,
      last_contact_summary, revision, origin_change_id, recorded_at
    FROM ranked
    WHERE rank = 1
      AND NOT EXISTS (
        SELECT 1
        FROM meetings
        JOIN meeting_participants
          ON meeting_participants.meeting_id = meetings.id
          AND meeting_participants.person_id = ranked.person_id
          AND meeting_participants.is_deleted = 0
        WHERE substr(meetings.starts_at, 1, 10) = ranked.last_contacted
          AND coalesce(meetings.description, '') = coalesce(ranked.last_contact_summary, '')
      );
  `);

  const counts = database.query(`
    SELECT
      (SELECT count(*) FROM meetings) AS meetings,
      (SELECT count(*) FROM meeting_history) AS meeting_history,
      (SELECT count(*) FROM meeting_participants) AS meeting_participants,
      (SELECT count(*) FROM meeting_participant_history) AS meeting_participant_history,
      (SELECT count(*) FROM people WHERE last_contacted IS NOT NULL)
        + (SELECT count(*) FROM person_history WHERE last_contacted IS NOT NULL)
        AS person_contacts,
      (SELECT count(*) FROM interaction_person_contacts) AS person_imports,
      (SELECT count(*) FROM meetings
        WHERE external_calendar_id IS NOT NULL OR external_event_id IS NOT NULL)
        AS calendar_sources
  `).get() as Record<string, number>;
  const expectedInteractions = counts.meetings! + counts.person_imports!;
  const expectedSources = counts.calendar_sources!;

  database.exec(`
    DROP TABLE IF EXISTS temp.interaction_migration_expected;
    CREATE TEMP TABLE interaction_migration_expected (
      meetings integer,
      meeting_history integer,
      meeting_participants integer,
      meeting_participant_history integer,
      person_imports integer,
      expected_interactions integer,
      expected_sources integer
    );
  `);
  database.query("INSERT INTO interaction_migration_expected VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      counts.meetings!,
      counts.meeting_history!,
      counts.meeting_participants!,
      counts.meeting_participant_history!,
      counts.person_imports!,
      expectedInteractions,
      expectedSources,
    );

  return {
    meetings: counts.meetings!,
    meetingHistory: counts.meeting_history!,
    meetingParticipants: counts.meeting_participants!,
    meetingParticipantHistory: counts.meeting_participant_history!,
    personLastContacts: counts.person_contacts!,
    expectedInteractions,
    expectedSources,
    importedInteractions: 0,
    importedSources: 0,
    duplicates: counts.person_contacts! - counts.person_imports!,
  };
}

export function completeInteractionMigrationReport(
  database: Database,
  report: InteractionMigrationReport,
) {
  return {
    ...report,
    importedInteractions: (database.query(
      "SELECT count(*) AS count FROM interactions",
    ).get() as { count: number }).count,
    importedSources: (database.query(
      "SELECT count(*) AS count FROM interaction_sources",
    ).get() as { count: number }).count,
  };
}

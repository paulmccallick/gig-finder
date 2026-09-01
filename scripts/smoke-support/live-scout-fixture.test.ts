import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrateDatabase } from "../../src/data/database";
import { seedLiveScoutFixture } from "./live-scout-fixture";

test("live Scout fixture preserves the run-company display snapshot", () => {
  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(database);

    seedLiveScoutFixture(database, {
      now: "2026-08-20T00:00:00.000Z",
      positionId: "smoke-live-scout-position",
      description: "Synthetic fixture description.",
      descriptionHash: "fixture-description-hash",
      artifactId: "smoke-live-artifact",
      descriptionId: "smoke-live-description",
      profile: { name: "Synthetic Smoke Candidate" },
      profileHash: "fixture-profile-hash",
    });

    expect(database.query(`
      SELECT company_name AS companyName
      FROM scout_run_companies
      WHERE id = 'smoke-live-run-company'
    `).get()).toEqual({ companyName: "Synthetic Systems" });
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    database.close();
  }
});

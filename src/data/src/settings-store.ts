import type { Database } from "bun:sqlite";
import type { ApplicationSettingsRepository } from "../../core/src/ports";

export class SqliteApplicationSettingsRepository
implements ApplicationSettingsRepository {
  constructor(private readonly database: Database) {}

  get(key: string): string | null {
    const row = this.database.query(
      "SELECT value FROM application_settings WHERE key = ?",
    ).get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.database.query(`
      INSERT INTO application_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }
}

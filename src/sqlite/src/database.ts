import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";

export const migrationsFolder = path.resolve(import.meta.dir, "../drizzle");

export function openDatabase(filename: string, options: { create?: boolean } = {}): Database {
  const database = new Database(filename, { create: options.create ?? true, strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

export function migrateDatabase(database: Database): void {
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    migrate(drizzle(database), { migrationsFolder });
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

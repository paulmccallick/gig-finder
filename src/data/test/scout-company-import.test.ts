import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrateDatabase } from "../database";
import { SqliteScoutCompanyImportStore } from "../scout-company-import-store";
import { importScoutCompanies } from "../../core/scout/engine/company-import";
import { scoutTemplateCatalog } from "../../operations/scout-template-catalog";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const fixture = (titlePath = "title") => ({
  version: 1 as const,
  companies: [
    {
      id: "company-1",
      name: "Example Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json" as const,
          url: "https://careers.example.test/jobs",
          active: true,
          method: "GET" as const,
          recordsPath: "jobs",
          fields: { title: titlePath, url: "url" },
        },
      ],
    },
  ],
});
describe("private Scout company import", () => {
  test("is transactional, idempotent, and creates immutable versions", () => {
    const root = mkdtempSync(path.join("tmp/", "scout-import-"));
    roots.push(root);
    const database = openDatabase(path.join(root, "test.sqlite"));
    migrateDatabase(database);
    const store = new SqliteScoutCompanyImportStore(database);
    expect(importScoutCompanies(fixture(), store)).toEqual({
      created: 1,
      unchanged: 0,
      versioned: 0,
      rejected: 0,
    });
    expect(importScoutCompanies(fixture(), store)).toEqual({
      created: 0,
      unchanged: 1,
      versioned: 0,
      rejected: 0,
    });
    expect(importScoutCompanies(fixture("role.title"), store)).toEqual({
      created: 0,
      unchanged: 0,
      versioned: 1,
      rejected: 0,
    });
    expect(
      (
        database
          .query("SELECT count(*) count FROM scout_company_configurations")
          .get() as { count: number }
      ).count,
    ).toBe(2);
    database.close();
  });
  test("rejects the whole file before writing", () => {
    const root = mkdtempSync(path.join("tmp/", "scout-import-"));
    roots.push(root);
    const database = openDatabase(path.join(root, "test.sqlite"));
    migrateDatabase(database);
    const report = importScoutCompanies(
      {
        version: 1,
        companies: [fixture().companies[0], fixture().companies[0]],
      },
      new SqliteScoutCompanyImportStore(database),
    );
    expect(report.rejected).toBeGreaterThan(0);
    expect(
      (
        database.query("SELECT count(*) count FROM scout_companies").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    database.close();
  });
  test("persists a reusable JSON template with validated tenant variables", () => {
    const root = mkdtempSync(path.join("tmp/", "scout-import-"));
    roots.push(root);
    const database = openDatabase(path.join(root, "test.sqlite"));
    migrateDatabase(database);
    const store = new SqliteScoutCompanyImportStore(database);
    const company = {
      id: "company-platform",
      name: "Platform Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json" as const,
          url: "https://careers.example.test/api/jobs",
          active: true,
          template: { id: "workday", version: 1 },
          variables: { tenant: "example", site: "External" },
        },
      ],
    };
    expect(
      importScoutCompanies(
        { version: 1, companies: [company] },
        store,
        scoutTemplateCatalog,
      ),
    ).toEqual({ created: 1, unchanged: 0, versioned: 0, rejected: 0 });
    expect(
      database
        .query(
          "SELECT source_type,settings_json FROM scout_company_configuration_sources",
        )
        .get(),
    ).toEqual({
      source_type: "json",
      settings_json: expect.stringContaining(
        '"template":{"id":"workday","version":1}',
      ),
    });
    expect(
      String(
        (
          database
            .query(
              "SELECT settings_json FROM scout_company_configuration_sources",
            )
            .get() as { settings_json: string }
        ).settings_json,
      ),
    ).toContain('"tenant":"example"');
    database.close();
  });
  test("requires one authoritative active source per company", () => {
    const root = mkdtempSync(path.join("tmp/", "scout-import-"));
    roots.push(root);
    const database = openDatabase(path.join(root, "test.sqlite"));
    migrateDatabase(database);
    const company = fixture().companies[0]!;
    const result = importScoutCompanies(
      {
        version: 1,
        companies: [
          {
            ...company,
            sources: [company.sources[0], { ...company.sources[0], key: "fallback" }],
          },
        ],
      },
      new SqliteScoutCompanyImportStore(database),
    );
    expect(result.rejected).toBeGreaterThan(0);
    database.close();
  });
});

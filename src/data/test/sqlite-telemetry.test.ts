import { test, expect } from "bun:test";
import { openDatabase, migrateDatabase } from "../database";
import { DataStore } from "../store";
import type { PersonData } from "../../core/models";

test("logs every SQLite statement execution without logging SQL or parameters", () => {
  const events: Array<Record<string, unknown>> = [];
  const database = openDatabase(":memory:", {
    logger: {
      info(fields) { events.push(fields); },
      error(fields) { events.push(fields); },
    },
  });
  database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)");
  database.query("INSERT INTO items (label) VALUES (?)").run("private value");
  database.query("SELECT * FROM items WHERE id = ?").get(1);
  database.query("SELECT * FROM items").all();

  expect(events).toHaveLength(3);
  expect(events.map((event) => event.phase)).toEqual(["run", "get", "all"]);
  expect(events.every((event) => event.event === "database.query")).toBe(true);
  expect(events.every((event) => typeof event.durationMs === "number")).toBe(true);
  expect(JSON.stringify(events)).not.toContain("private value");
  expect(JSON.stringify(events)).not.toContain("SELECT * FROM items");
  database.close();
});

test("instrumented databases preserve audited repository writes and reads", () => {
  const events: Array<Record<string, unknown>> = [];
  const database = openDatabase(":memory:", {
    logger: { info(fields) { events.push(fields); }, error(fields) { events.push(fields); } },
  });
  migrateDatabase(database);
  const store = new DataStore(database);
  const person: PersonData = {
    id: "person", name: "Synthetic Person", company: null, title: null,
    linkedInProfileUrl: null, connectedOn: null, relationshipType: "professional_contact",
    relationshipStrength: "unknown", introducedBy: null, relationshipNotes: null,
    priority: "unranked", status: "not_contacted", whyInteresting: null,
    notesJson: "[]", tagsJson: "[]",
  };
  store.change({ actor: "test", source: "test", summary: "create person" }, tx => tx.people.create(person));
  store.change({ actor: "test", source: "test", summary: "update person" }, tx => tx.people.update("person", 1, { title: "Director" }));
  expect(store.people.get("person")).toMatchObject({ name: "Synthetic Person", title: "Director", revision: 2 });
  expect(events.some(event => event.operation === "database.change")).toBe(true);
  database.close();
});

test("labels queries inside audited changes with the change operation", () => {
  const events: Array<Record<string, unknown>> = [];
  const database = openDatabase(":memory:", {
    logger: { info(fields) { events.push(fields); }, error(fields) { events.push(fields); } },
  });
  database.exec("CREATE TABLE changes (id TEXT PRIMARY KEY)");
  database.query("INSERT INTO changes (id) VALUES (?)").run("change-1");
  expect(events[0]?.operation).toBe("database.application");
  database.close();
});

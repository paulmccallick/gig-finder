import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../../..");

describe("application boundaries", () => {
  test("UI command and component code does not import SQLite adapters", () => {
    const consumers = [
      "src/cli/src/cli.ts",
      "src/web/src/App.tsx",
      "src/web/src/NetworkingBoard.tsx",
      "src/web/src/TaskBoard.tsx",
    ];

    for (const relative of consumers) {
      const source = readFileSync(path.join(root, relative), "utf8");
      expect(source).not.toContain("src/sqlite");
    }
  });

  test("core remains independent of SQLite and application UIs", () => {
    for (const relative of ["src/application.ts", "src/services.ts", "src/tracker-services.ts", "src/ports.ts"]) {
      const source = readFileSync(path.join(import.meta.dir, "..", relative), "utf8");
      expect(source).not.toMatch(/packages\/sqlite|apps\/(cli|web)/);
    }
  });

  test("CLI and web adapters do not contain legacy document projection behavior",()=>{
    for(const relative of ["src/cli/src/db-store.ts","src/web/server.ts","src/web/src/data/jobs.ts","src/web/src/data/contacts.ts","src/web/src/data/tasks.ts"]){
      const source=readFileSync(path.join(root,relative),"utf8");
      expect(source).not.toMatch(/schemaVersion|parseJobIndex|parseNetworkIndex|parseTaskIndex|jobIndexProjection|networkProjection|taskProjection/);
    }
  });
  test("adapters use the shared local application instead of constructing repositories",()=>{
    for(const relative of ["src/cli/src/db-store.ts","src/web/server.ts"]){
      const source=readFileSync(path.join(root,relative),"utf8");
      expect(source).not.toMatch(/new DataStore|new JobSearchApplication|openDatabase/);
      expect(source).toContain("openLocalApplication");
    }
  });

  test("the agent package does not own the inbound HTTP protocol", () => {
    const agentRoot = path.join(root, "src/agent");
    expect(existsSync(path.join(agentRoot, "http.ts"))).toBe(false);

    for (const entry of readdirSync(agentRoot, { recursive: true })) {
      if (typeof entry !== "string" || !entry.endsWith(".ts") || entry.includes("/test/")) continue;
      const source = readFileSync(path.join(agentRoot, entry), "utf8");
      expect(source).not.toMatch(/\bRequest\b|\bResponse\b|toUIMessageStreamResponse|Response\.json/);
    }
  });
});

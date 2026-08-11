import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

test("Gig Scout has no workflow, persistence, UI, filesystem, browser, or screening dependency", async () => {
  const root = path.resolve(import.meta.dir, ".."); const files: string[] = [];
  const visit = async (directory: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) await visit(path.join(directory, item.name));
      else if (item.name.endsWith(".ts")) files.push(path.join(directory, item.name));
    }
  };
  await visit(root);
  const production = files.filter(file => !file.includes(`${path.sep}test${path.sep}`));
  const text = (await Promise.all(production.map(file => readFile(file, "utf8")))).join("\n");
  expect(text).not.toMatch(/bun:sqlite|drizzle|bunqueue|playwright|src\/web|src\/data|node:fs|titleFilter|locationFilter|company registry/i);
});

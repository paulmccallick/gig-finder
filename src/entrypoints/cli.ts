import path from "node:path";
import { runCli } from "../cli/src/cli";
import { openLocalApplication, resolveJobSearchContext } from "../sqlite/src";

const repoRoot = path.resolve(import.meta.dir, "../..");
const context = resolveJobSearchContext(repoRoot);
const local = openLocalApplication({
  database: context.database,
  artifacts: context.artifacts,
});

try {
  await runCli(process.argv.slice(2), {
    application: local.application,
    actor: context.actor,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  local.close();
}

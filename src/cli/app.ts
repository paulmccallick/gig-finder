import path from "node:path";
import { openLocalApplication, resolveGigFinderContext } from "../data/src";
import { cliUsage, runCli } from "./src/cli";

const repoRoot = path.resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(cliUsage);
  process.exit(0);
}

const context = resolveGigFinderContext(repoRoot);
const local = openLocalApplication({
  database: context.database,
  artifacts: context.artifacts,
  profileDocuments: context.profileDocuments,
});

try {
  await runCli(args, {
    application: local.application,
    actor: context.actor,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  local.close();
}

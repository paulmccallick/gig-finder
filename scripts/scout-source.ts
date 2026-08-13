import path from "node:path";
import { runScoutHarness } from "../src/operations/scout-harness";
const value = (name: string) => {
    const index = Bun.argv.indexOf(name);
    return index >= 0 ? Bun.argv[index + 1] : undefined;
  },
  configPath = value("--config"),
  outputPath = value("--output");
if (!configPath || !outputPath)
  throw new Error(
    "Usage: bun run scripts/scout-source.ts --config <private.json> --output <ignored.json> [--company <id>] [--source <key>] [--template <name>] [--term <private term>] [--pages <count>]",
  );
const absoluteOutput = path.resolve(outputPath),
  ignored = Bun.spawnSync(["git", "check-ignore", "-q", absoluteOutput]);
if (ignored.exitCode !== 0)
  throw new Error("Harness output must be under a git-ignored private path.");
const raw = await Bun.file(path.resolve(configPath)).json();
const report = await runScoutHarness(raw, {
  companyId: value("--company"),
  sourceKey: value("--source"),
  template: value("--template"),
  term: value("--term"),
  maxPages: Number(value("--pages") ?? 2),
});
await Bun.write(absoluteOutput, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: report.passed,
    sourceCount: report.sourceCount,
    output: absoluteOutput,
  }),
);
if (!report.passed) process.exitCode = 1;

import { syncProductionInputs } from "./production-inputs";

const [sourceRoot, stateRoot, configFile] = process.argv.slice(2);
if (!sourceRoot || !stateRoot || !configFile) {
  throw new Error("Usage: sync-production-context <source-root> <state-root> <config-file>");
}

console.log(JSON.stringify(
  await syncProductionInputs(sourceRoot, stateRoot, configFile),
  null,
  2,
));

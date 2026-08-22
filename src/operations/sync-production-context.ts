import { finalizeProductionInputs, rollbackProductionInputs, syncProductionInputs } from "./production-inputs";

const [mode, ...arguments_] = process.argv.slice(2);

if (mode === "--finalize" || mode === "--rollback") {
  const manifest = arguments_[0];
  if (!manifest) throw new Error(`${mode} requires a transaction manifest.`);
  if (mode === "--finalize") await finalizeProductionInputs(manifest);
  else await rollbackProductionInputs(manifest);
  console.log(JSON.stringify({ ok: true, mode, manifest }));
} else {
  const [sourceRoot, stateRoot, configFile] = process.argv.slice(2);
  if (!sourceRoot || !stateRoot || !configFile) {
    throw new Error("Usage: sync-production-context <source-root> <state-root> <config-file>");
  }
  console.log(JSON.stringify(
    await syncProductionInputs(sourceRoot, stateRoot, configFile),
    null,
    2,
  ));
}

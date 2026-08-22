import { finalizeProductionInputs, rollbackProductionInputs, syncProductionInputs } from "./production-inputs";

const [mode, ...arguments_] = process.argv.slice(2);

if (mode === "--finalize" || mode === "--rollback") {
  const [manifest, sourceRoot, stateRoot, configTarget] = arguments_;
  if (!manifest || !sourceRoot || !stateRoot || !configTarget) {
    throw new Error(`${mode} requires manifest, source root, state root, and config target.`);
  }
  if (mode === "--finalize") await finalizeProductionInputs(manifest, sourceRoot, stateRoot, configTarget);
  else await rollbackProductionInputs(manifest, sourceRoot, stateRoot, configTarget);
  console.log(JSON.stringify({ ok: true, mode, manifest }));
} else {
  const [sourceRoot, stateRoot, configFile, transactionManifest] = process.argv.slice(2);
  if (!sourceRoot || !stateRoot || !configFile) {
    throw new Error("Usage: sync-production-context <source-root> <state-root> <config-file>");
  }
  console.log(JSON.stringify(
    await syncProductionInputs(sourceRoot, stateRoot, configFile, undefined, transactionManifest),
    null,
    2,
  ));
}

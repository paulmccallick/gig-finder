const worker = Bun.file("dist/server/pdf.worker.mjs");
if (!(await worker.exists())) throw new Error("Production PDF worker is missing");

const server = await Bun.file("dist/server/server.js").text();
for (const smokeOnlyMarker of ["knownProviderRules", "Invalid provider tool schema"]) {
  if (server.includes(smokeOnlyMarker)) {
    throw new Error(`Production server bundle contains smoke-only code: ${smokeOnlyMarker}`);
  }
}

export {};

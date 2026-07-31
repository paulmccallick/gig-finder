/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-is-independent",
      severity: "error",
      comment: "Core domain code must not depend on application adapters.",
      from: { path: "^src/core/" },
      to: { path: "^src/(agent|cli|data|observability|web)/" },
    },
    {
      name: "data-is-an-outbound-adapter",
      severity: "error",
      comment: "Data adapters may depend on core, but not on inbound adapters.",
      from: { path: "^src/data/" },
      to: { path: "^src/(agent|cli|observability|web)/" },
    },
    {
      name: "agent-does-not-own-adapters",
      severity: "error",
      comment: "Agent policy and tools use core services, not SQLite or inbound adapters.",
      from: { path: "^src/agent/" },
      to: { path: "^src/(cli|data|web)/" },
    },
    {
      name: "cli-depends-only-on-core",
      severity: "error",
      comment: "The CLI receives the core application from an outer composition root.",
      from: { path: "^src/cli/src/" },
      to: { path: "^src/(agent|data|entrypoints|observability|web)/" },
    },
    {
      name: "dashboard-depends-only-on-core",
      severity: "error",
      comment: "Browser-facing dashboard code may use core contracts, but no application adapters.",
      from: { path: "^src/web/src/" },
      to: { path: "^src/(agent|cli|data|entrypoints|observability)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)node_modules/|(^|/)dist/|(^|/)context/" },
    tsConfig: { fileName: "src/web/tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } },
  },
};

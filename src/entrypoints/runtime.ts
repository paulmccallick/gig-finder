import path from "node:path";

export type GigFinderRuntimeMode = "development" | "test" | "production";

export interface GigFinderRuntimeConfiguration {
  mode: GigFinderRuntimeMode;
  hostname: string;
  port: number;
  staticRoot: string | null;
  revision: string;
}

type RuntimeEnvironment = Record<string, string | undefined>;

const positivePort = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("API_PORT must be an integer from 1 through 65535.");
  }
  return parsed;
};

const isWithin = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const isRuntimeMode = (value: string): value is GigFinderRuntimeMode =>
  value === "development" || value === "test" || value === "production";

export function resolveGigFinderRuntime(
  applicationRoot: string,
  environment: RuntimeEnvironment = process.env,
): GigFinderRuntimeConfiguration {
  const configuredMode = environment.GIG_FINDER_RUNTIME
    ?? (environment.NODE_ENV === "production"
      ? "production"
      : environment.NODE_ENV === "test" ? "test" : "development");
  if (!isRuntimeMode(configuredMode)) {
    throw new Error("GIG_FINDER_RUNTIME must be development, test, or production.");
  }
  const mode = configuredMode;

  if (mode !== "production") {
    return {
      mode,
      hostname: "127.0.0.1",
      port: positivePort(environment.API_PORT, 3101),
      staticRoot: null,
      revision: environment.GIG_FINDER_REVISION?.trim() || "development",
    };
  }

  const contextRoot = environment.GIG_FINDER_CONTEXT_ROOT?.trim();
  if (!contextRoot || !path.isAbsolute(contextRoot)) {
    throw new Error(
      "Production requires an absolute GIG_FINDER_CONTEXT_ROOT outside the repository.",
    );
  }
  const resolvedApplicationRoot = path.resolve(applicationRoot);
  const resolvedContextRoot = path.resolve(contextRoot);
  if (isWithin(resolvedApplicationRoot, resolvedContextRoot)) {
    throw new Error("Production context must be outside the application repository.");
  }
  const codexHome = environment.CODEX_HOME?.trim();
  if (!codexHome || !path.isAbsolute(codexHome)) {
    throw new Error("Production requires an absolute CODEX_HOME credential mount.");
  }
  const revision = environment.GIG_FINDER_REVISION?.trim();
  if (!revision || !/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error("Production requires GIG_FINDER_REVISION as a 40-character commit SHA.");
  }
  const staticRoot = environment.GIG_FINDER_STATIC_ROOT?.trim()
    || path.join(resolvedApplicationRoot, "dist", "client");
  if (!path.isAbsolute(staticRoot)) {
    throw new Error("GIG_FINDER_STATIC_ROOT must be absolute when provided.");
  }

  return {
    mode,
    hostname: "0.0.0.0",
    port: positivePort(environment.API_PORT, 3001),
    staticRoot: path.resolve(staticRoot),
    revision: revision.toLowerCase(),
  };
}

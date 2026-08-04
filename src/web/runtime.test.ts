import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveGigFinderRuntime } from "../entrypoints/runtime";

const applicationRoot = path.resolve(import.meta.dir, "../..");

describe("runtime environment isolation", () => {
  test("uses loopback development defaults without static production assets", () => {
    expect(resolveGigFinderRuntime(applicationRoot, {})).toEqual({
      mode: "development",
      hostname: "127.0.0.1",
      port: 3101,
      staticRoot: null,
      revision: "development",
    });
  });

  test("requires production context and credentials outside the repository", () => {
    const productionRoot = path.resolve(applicationRoot, "../gig-finder-production");
    expect(resolveGigFinderRuntime(applicationRoot, {
      GIG_FINDER_RUNTIME: "production",
      GIG_FINDER_CONTEXT_ROOT: productionRoot,
      CODEX_HOME: path.resolve(applicationRoot, "../codex-credentials"),
      GIG_FINDER_REVISION: "a".repeat(40),
    })).toEqual({
      mode: "production",
      hostname: "0.0.0.0",
      port: 3001,
      staticRoot: path.join(applicationRoot, "dist", "client"),
      revision: "a".repeat(40),
    });

    expect(() => resolveGigFinderRuntime(applicationRoot, {
      GIG_FINDER_RUNTIME: "production",
      GIG_FINDER_CONTEXT_ROOT: path.join(applicationRoot, "context", "production"),
      CODEX_HOME: "/run/codex",
      GIG_FINDER_REVISION: "a".repeat(40),
    })).toThrow("outside the application repository");
    expect(() => resolveGigFinderRuntime(applicationRoot, {
      GIG_FINDER_RUNTIME: "production",
      GIG_FINDER_CONTEXT_ROOT: productionRoot,
      GIG_FINDER_REVISION: "a".repeat(40),
    })).toThrow("absolute CODEX_HOME");
  });
});

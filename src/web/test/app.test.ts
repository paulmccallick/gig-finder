import { describe, expect, test } from "bun:test";
import path from "node:path";
import { loadWebConfiguration } from "../app";

const applicationRoot = path.resolve(import.meta.dir, "../../..");
const contextRoot = path.join(applicationRoot, "tmp", "configuration-test-context");

describe("web process configuration", () => {
  test("uses environment-neutral local defaults", () => {
    const configuration = loadWebConfiguration(applicationRoot, {
      GIG_FINDER_CONTEXT_ROOT: contextRoot,
    });
    expect(configuration.server).toEqual({
      hostname: "127.0.0.1",
      port: 3000,
      staticRoot: null,
      revision: "unversioned",
    });
    expect(configuration.aiSdkDevTools).toBe(false);
  });

  test("accepts explicit host configuration without an environment mode", () => {
    const configuration = loadWebConfiguration(applicationRoot, {
      HOST: "0.0.0.0",
      PORT: "3001",
      STATIC_ROOT: "dist/client",
      APP_REVISION: "a".repeat(40),
      AI_SDK_DEVTOOLS: "true",
      GIG_FINDER_CONTEXT_ROOT: contextRoot,
    });
    expect(configuration.server).toEqual({
      hostname: "0.0.0.0",
      port: 3001,
      staticRoot: path.join(applicationRoot, "dist", "client"),
      revision: "a".repeat(40),
    });
    expect(configuration.aiSdkDevTools).toBe(true);
  });

  test("rejects invalid ports", () => {
    expect(() => loadWebConfiguration(applicationRoot, {
      PORT: "0",
      GIG_FINDER_CONTEXT_ROOT: contextRoot,
    })).toThrow("PORT must be a positive integer");
    expect(() => loadWebConfiguration(applicationRoot, {
      PORT: "65536",
      GIG_FINDER_CONTEXT_ROOT: contextRoot,
    })).toThrow("PORT must not exceed 65535");
  });
});

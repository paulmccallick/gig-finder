import { expect, test } from "bun:test";
import { smokeEnvironment } from "./environment";

test("smoke child environments cannot inherit application or legacy state overrides", () => {
  expect(smokeEnvironment({
    PATH: "/synthetic/bin",
    GIG_FINDER_DATABASE: "/real/gig-finder.db",
    JOB_SEARCH_CONTEXT_ROOT: "/real/context",
    LOG_DIRECTORY: "/real/logs",
    CODEX_HOME: "/real/codex",
  }, {
    GIG_FINDER_CONTEXT_ROOT: "/synthetic/context",
    CODEX_HOME: "/synthetic/codex",
  })).toEqual({
    PATH: "/synthetic/bin",
    GIG_FINDER_CONTEXT_ROOT: "/synthetic/context",
    CODEX_HOME: "/synthetic/codex",
  });
});

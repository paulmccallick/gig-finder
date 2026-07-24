import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  outputDir: "../../test-results/playwright",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    cwd: "../..",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

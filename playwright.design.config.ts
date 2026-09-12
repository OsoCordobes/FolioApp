/** Existing isolated development server only. No ordinary app server or hosted endpoint. */
import { defineConfig } from "@playwright/test";

if (process.env.FOLIO_TEST_ISOLATED !== "1" || process.env.E2E_BASE_URL !== "http://127.0.0.1:4410") {
  throw new Error("Run through scripts/testing/app-bootstrap.mjs against the isolated design server.");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: /e2e\/(landing|side-art|design-print)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [["list"], ["json", { outputFile: "docs/design/evidence/public-e2e-results.json" }]],
  outputDir: "docs/design/evidence/public-e2e-artifacts",
  use: { baseURL: "http://127.0.0.1:4410", viewport: { width: 1440, height: 900 },
    colorScheme: "light", contextOptions: { reducedMotion: "reduce" }, serviceWorkers: "block", screenshot: "only-on-failure" },
});

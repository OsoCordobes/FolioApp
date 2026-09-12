/** Isolated loopback visual comparison; deliberately no webServer launcher. */
import { defineConfig } from "@playwright/test";

if (process.env.FOLIO_TEST_ISOLATED !== "1" || process.env.E2E_BASE_URL !== "http://127.0.0.1:4410") {
  throw new Error("Use the isolated app bootstrap and design server on 4410.");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: /visual\/landing\.spec\.ts/,
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
  fullyParallel: false, workers: 1, retries: 0, timeout: 30000,
  reporter: [["list"], ["json", { outputFile: "docs/design/evidence/visual-landing-results.json" }]],
  outputDir: "docs/design/evidence/visual-landing-artifacts",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide" } },
  use: { baseURL: "http://127.0.0.1:4410", viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1, serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } },
});

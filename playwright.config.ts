import { defineConfig, devices } from "@playwright/test";

const PROTOTYPE_PORT = 4001;
// const APP_PORT = 3010;  // se activa en F1 cuando se compare la app contra los baselines

const PROTOTYPE_ROOT = "C:\\Users\\amiun\\Desktop\\Folio";

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: `http://localhost:${PROTOTYPE_PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "prototype",
      testMatch: /baseline\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${PROTOTYPE_PORT}`,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: `pnpm exec serve -l ${PROTOTYPE_PORT} "${PROTOTYPE_ROOT}"`,
      url: `http://localhost:${PROTOTYPE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});

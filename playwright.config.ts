import { defineConfig, devices } from "@playwright/test";

const PROTOTYPE_PORT = 4001;
const APP_PORT = 3010;

const PROTOTYPE_ROOT = "C:\\Users\\amiun\\Desktop\\Folio";

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",

  /**
   * Snapshots compartidos entre todos los specs y projects, sin sufijos
   * de project/platform. Permite que el spec del prototipo (`baseline.spec.ts`)
   * genere el baseline, y el spec de la app (`app.spec.ts`) compare contra
   * exactamente el mismo archivo .png.
   */
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
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
    {
      name: "app",
      testMatch: /app\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${APP_PORT}`,
        viewport: { width: 1440, height: 900 },
      },
      dependencies: [],
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
    {
      command: `pnpm dev`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});

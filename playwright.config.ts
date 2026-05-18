import { defineConfig, devices } from "@playwright/test";

const PROTOTYPE_PORT = 4001;
const APP_PORT = 3010;

const PROTOTYPE_ROOT = "C:\\Users\\amiun\\Desktop\\Folio";

/**
 * Configuración base. Tres projects:
 *   - `prototype` — sirve el HTML estático del prototipo en localhost:4001.
 *   - `app` — corre Next dev en localhost:3010 y compara visualmente.
 *   - `e2e` — corre auth + onboarding + nav contra `E2E_BASE_URL`
 *     (default: localhost:3010 si dev server activo; override a https://prod
 *     para validar contra producción). Requiere envs reales (Supabase keys,
 *     FOLIO_ENC_KEY) para que el dev server arranque.
 */
const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${APP_PORT}`;

export default defineConfig({
  testDir: "./tests",
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
      testMatch: /visual\/app\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${APP_PORT}`,
        viewport: { width: 1440, height: 900 },
      },
      dependencies: [],
    },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: E2E_BASE_URL,
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

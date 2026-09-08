import { defineConfig, devices } from "@playwright/test";

import "./scripts/testing/app-bootstrap.mjs";
import { LOCAL_BROWSER_ARGS } from "./scripts/testing/browser-network.mjs";

// Bootstrap validates local targets, clears inherited credentials and blocks env
// files/provider I/O before any owned app process is launched.
const E2E_BASE_URL=process.env.E2E_BASE_URL!;
const prototypeRoot=process.env.FOLIO_TEST_PROTOTYPE_ROOT;
const onlyPrototype=process.argv.includes("--project=prototype");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : [["html", {open:"never"}], ["list"]],

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
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
    launchOptions: {args:LOCAL_BROWSER_ARGS},
    trace: "retain-on-failure",
  },
  projects: [
    ...(prototypeRoot?[{name:"prototype",testMatch:/baseline\.spec\.ts/,use:{...devices["Desktop Chrome"],baseURL:"http://127.0.0.1:4001",viewport:{width:1440,height:900}}}]:[]),
    {name:"app",testMatch:/visual\/(app|landing)\.spec\.ts/,use:{...devices["Desktop Chrome"],baseURL:E2E_BASE_URL,viewport:{width:1440,height:900}}},
    {name:"e2e",testMatch:/e2e\/.*\.spec\.ts/,use:{...devices["Desktop Chrome"],baseURL:E2E_BASE_URL}},
  ],
  webServer: [
    ...(prototypeRoot?[{command:"node scripts/testing/prototype-server.mjs",url:"http://127.0.0.1:4001",reuseExistingServer:false,timeout:60000}]:[]),
    ...(!onlyPrototype?[{command:"node scripts/testing/app-server.mjs",url:E2E_BASE_URL,reuseExistingServer:false,timeout:120000}]:[]),
  ],
});

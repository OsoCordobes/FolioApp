/** Reproducible hotfix checks. No application environment is inherited. */
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installIsolation } from "../../scripts/testing/install-isolation.mjs";
import { safeEnvironment } from "../../scripts/testing/isolation-policy.mjs";

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), "../..");
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const mode = process.argv[2] ?? "unit";
  const commands = {
    unit: ["--test", "--conditions", "react-server", "--import", "tsx", "tests/unit/hoy-transition-replay.test.ts", "tests/unit/hoy-kpi-cobro.test.ts"],
    "unit-all": ["--test", "--conditions", "react-server", "--import", "tsx", "tests/unit/**/*.test.ts"],
    typecheck: ["node_modules/typescript/bin/tsc", "--noEmit"],
    lint: ["node_modules/eslint/bin/eslint.js"],
    build: ["node_modules/next/dist/bin/next", "build", "--turbopack"],
    browser: ["tests/hoy/browser.cjs"],
  };
  if (!(mode in commands)) throw new Error("Unknown hotfix check");
  const env = safeEnvironment(process.env, { mode: mode === "build" ? "build" : "unit" });
  Object.assign(env, {
    NODE_OPTIONS: `--import ${pathToFileURL(self).href}`,
    NEXT_TELEMETRY_DISABLED: "1",
    CRON_SECRET: "synthetic-cron-not-a-credential",
  });
  // Let the package manager resolve its own build/lint dependencies through its
  // supported executable, rather than injecting an internal module path.
  const packageManager = mode === "lint" || mode === "build";
  const args = mode === "lint" ? ["exec", "eslint"] : mode === "build" ? ["exec", "next", "build", "--turbopack"] : commands[mode];
  const child = spawn(packageManager ? "pnpm" : process.execPath, args, {
    cwd: root, env, stdio: "inherit", windowsHide: true, shell: packageManager && process.platform === "win32",
  });
  child.on("error", () => { process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} else {
  installIsolation();
}

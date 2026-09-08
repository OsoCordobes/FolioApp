import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { installIsolation } from "../../scripts/testing/install-isolation.mjs";
import { safeEnvironment } from "../../scripts/testing/isolation-policy.mjs";
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const child = spawn(process.execPath, ["tests/pacientes-directory/browser.cjs"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), windowsHide: true, stdio: "inherit",
    env: { ...safeEnvironment(process.env), NODE_OPTIONS: `--import ${import.meta.url}` },
  });
  child.on("error", () => { process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else installIsolation();

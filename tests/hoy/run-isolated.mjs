/** Reproducible hotfix checks. No application environment is inherited. */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), "../..");
const loopback = (host) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(host).toLowerCase());

function installGuards() {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === "object" ? first : {};
    const pipe = options.path ?? (typeof first === "string" && !/^\d+$/.test(first) ? first : null);
    if (!pipe) {
      const host = options.host ?? options.hostname ?? (typeof args[1] === "string" ? args[1] : "localhost");
      if (!loopback(host)) throw new Error("FOLIO_TEST_EXTERNAL_NETWORK_BLOCKED");
    }
    return connect.apply(this, args);
  };
  const checkFile = (file) => {
    const name = path.basename(String(file));
    if (name.startsWith(".env") && !name.endsWith(".example")) throw new Error("FOLIO_TEST_ENV_FILE_BLOCKED");
  };
  const readSync = fs.readFileSync;
  fs.readFileSync = function (file, ...args) { checkFile(file); return readSync.call(this, file, ...args); };
  const read = fs.readFile;
  fs.readFile = function (file, ...args) { checkFile(file); return read.call(this, file, ...args); };
  const readPromise = fs.promises.readFile;
  fs.promises.readFile = async function (file, ...args) { checkFile(file); return readPromise.call(this, file, ...args); };
  syncBuiltinESMExports();
}

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
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(path|systemroot|windir|userprofile|temp|tmp|localappdata|appdata|comspec|pathext|pnpm_home)$/i.test(name)) env[name] = value;
  }
  Object.assign(env, {
    NODE_OPTIONS: `--import ${pathToFileURL(self).href}`,
    NEXT_TELEMETRY_DISABLED: "1",
    FOLIO_ENC_KEY: Buffer.alloc(32, 17).toString("base64"),
    FOLIO_ENC_HMAC_KEY: Buffer.alloc(32, 23).toString("base64"),
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-not-a-credential",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-not-a-credential",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3010",
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
  installGuards();
}

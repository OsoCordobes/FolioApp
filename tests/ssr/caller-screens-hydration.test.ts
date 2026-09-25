import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";

import { CallerScreensPanel } from "../../components/caller/caller-screens-panel";
import { LOCAL_BROWSER_ARGS } from "../../scripts/testing/browser-network.mjs";

const emptyInventory: Parameters<typeof CallerScreensPanel>[0]["initial"] = {
  ok: true, data: { screens: [], nextCursor: null },
};

test("caller mutations remain disabled in server HTML before handlers mount", () => {
  const timestamp = "2026-09-25T12:00:00.000Z";
  const initial: Parameters<typeof CallerScreensPanel>[0]["initial"] = {
    ok: true,
    data: {
      screens: [{ screenId: "11111111-1111-4111-8111-111111111111", createdAt: timestamp,
        pairExpiresAt: timestamp, tokenExpiresAt: timestamp, status: "activa" }],
      nextCursor: { createdAt: timestamp, screenId: "11111111-1111-4111-8111-111111111111" },
    },
  };
  const html = renderToStaticMarkup(createElement(CallerScreensPanel, { initial }));
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every(button => /\bdisabled=""/.test(button)));
});

test("caller first click after controlled hydration issues one code", { timeout: 30_000 }, async () => {
  const repo = process.cwd();
  const entry = `import React from "react";
import { hydrateRoot } from "react-dom/client";
import { CallerScreensPanel } from "./components/caller/caller-screens-panel";
 window.__callerProof = { pairCalls: 0, hydrationErrors: 0 };
hydrateRoot(document.getElementById("root"), React.createElement(CallerScreensPanel,
  { initial: { ok: true, data: { screens: [], nextCursor: null } } }),
  { onRecoverableError: () => { window.__callerProof.hydrationErrors++; } });`;
  const bundle = await build({
    stdin: { contents: entry, resolveDir: repo, sourcefile: "caller-proof-client.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(repo, "tsconfig.json"),
    plugins: [{ name: "caller-actions", setup(buildApi) {
      buildApi.onResolve({ filter: /^@\/app\/\(app\)\/configuracion\/pantallas\/actions$/ },
        args => ({ path: args.path, namespace: "caller-actions" }));
      buildApi.onLoad({ filter: /.*/, namespace: "caller-actions" }, () => ({
        contents: `export async function createCallerPairAction() {
          window.__callerProof.pairCalls++;
          return { ok: true, data: { pairCode: "0123456789abcdef", expiresAt: null } };
        }
        export async function listCallerScreensAction() {
          return { ok: true, data: { screens: [], nextCursor: null } };
        }
        export async function revokeCallerScreenAction() { throw Error("unused"); }`, loader: "js",
      }));
    } }],
  });
  const script = bundle.outputFiles?.[0]?.text;
  assert.ok(script);
  const markup = renderToString(createElement(CallerScreensPanel, { initial: emptyInventory }));
  let releaseScript: () => void = () => {};
  const scriptGate = new Promise<void>(resolve => { releaseScript = resolve; });
  const server = createServer(async (request, response) => {
    if (request.url === "/client.js") {
      await scriptGate;
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(script);
    } else {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="es"><body><div id="root">${markup}</div><script async src="/client.js"></script></body></html>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: LOCAL_BROWSER_ARGS });
    context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const button = page.getByRole("button", { name: "Generar código de vinculación" });
    await expect(button).toBeDisabled();
    releaseScript();
    await expect(button).toBeEnabled({ timeout: 5_000 });
    await button.click();
    await expect(page.locator(".caller-settings-code strong")).toHaveText("0123456789abcdef");
    const proof = await page.evaluate(() => (window as Window & { __callerProof?: { pairCalls: number; hydrationErrors: number } }).__callerProof);
    assert.equal(proof?.pairCalls, 1);
    assert.equal(proof?.hydrationErrors, 0);
  } finally {
    releaseScript();
    await context?.close();
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

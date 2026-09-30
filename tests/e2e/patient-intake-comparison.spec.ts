import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let server: Server;
let url: string;
let output: string;
test.beforeAll(async () => {
  output = await mkdtemp(path.join(tmpdir(), "folio-intake-component-"));
  await build({ entryPoints: ["tests/fixtures/patient-intake-comparison.tsx"], bundle: true, outfile: path.join(output, "app.js"),
    platform: "browser", jsx: "automatic", tsconfigRaw: { compilerOptions: { jsx: "react-jsx", baseUrl: process.cwd(), paths: { "@/*": ["./*"] } } },
    plugins: [{ name: "synthetic-staff-only", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/patient-intake\/staff$/ }, () => ({ path: path.resolve("tests/fixtures/patient-intake-comparison-staff.ts") }));
    } }] });
  const html = '<!doctype html><html lang="es" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comparación sintética Folio</title><style>@font-face{font-family:FolioFixture;src:url(/font.woff2) format("woff2");font-weight:200 800;font-display:swap}:root{--font-folio:FolioFixture,Arial,sans-serif}</style><link rel="stylesheet" href="/folio.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>';
  server = createServer(async (request, response) => {
    try {
      if (request.url === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
      const file = request.url === "/folio.css" ? "public/folio.css" : request.url === "/app.js" ? path.join(output, "app.js")
        : request.url === "/app.css" ? path.join(output, "app.css") : request.url === "/font.woff2" ? "public/fonts/plus-jakarta-sans-latin.woff2" : null;
      if (!file) { response.writeHead(404); response.end(); return; }
      response.setHeader("Content-Type", request.url?.endsWith(".css") ? "text/css" : request.url?.endsWith(".woff2") ? "font/woff2" : "application/javascript");
      response.end(await readFile(file));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(url);
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeEnabled();
});
async function compare(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Consultar aportes", exact: true }).click();
  await page.getByRole("button", { name: "Comparar con la ficha" }).click();
  await expect(page.getByRole("region", { name: "Comparación con la ficha" })).toBeVisible();
}
async function submit(page: import("@playwright/test").Page) {
  await page.getByRole("checkbox", { name: /^Nombre/ }).check();
  await page.getByRole("button", { name: "Revisar selección" }).click();
  await page.getByRole("button", { name: "Confirmar incorporación", exact: true }).click();
}

test("comparison, explicit selection, grouped document and honest provenance", async ({ page }) => {
  await compare(page);
  await expect(page.getByRole("checkbox")).toHaveCount(8);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revisar selección" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /^Documento/ }).check();
  await page.getByRole("button", { name: "Revisar selección" }).click();
  await page.getByRole("button", { name: "Confirmar incorporación", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Datos incorporados");
  expect(await page.evaluate(() => window.intakeFixture.operations[0].selectedKeys)).toEqual(["tipoDocumento", "numeroDocumento"]);
  await expect(page.getByRole("status")).toContainText("sin verificar");
});

test("lost response preserves operation and selection across close/reopen; cancellation uses same operation", async ({ page }) => {
  await page.evaluate(() => { window.intakeFixture.action = "lost"; });
  await compare(page); await submit(page);
  await expect(page.getByRole("group", { name: "Incorporación pendiente", exact: true })).toBeVisible();
  const operationId = await page.evaluate(() => window.intakeFixture.operations[0].operationId);
  await page.evaluate(() => window.closeFixture());
  await expect(page.getByText("Vista cerrada")).toBeVisible();
  await page.evaluate(() => window.reopenFixture());
  await expect(page.getByRole("group", { name: "Incorporación pendiente", exact: true })).toContainText("Nombre");
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeDisabled();
  await expect(page.getByText("Marina Sintética", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancelar misma operación" }).click();
  await expect(page.getByRole("status")).toContainText("Cancelación confirmada");
  expect(await page.evaluate(() => window.intakeFixture.cancelIds)).toEqual([operationId]);
  expect(await page.evaluate(() => window.intakeFixture.statusIds.every(id => id === window.intakeFixture.operations[0].operationId))).toBe(true);
  expect(await page.evaluate(() => window.intakeFixture.operations.length)).toBe(1);
});

test("terminal status reconciles lost commit; not_recorded blocks a new operation", async ({ page }) => {
  await page.evaluate(() => { window.intakeFixture.action = "lost"; });
  await compare(page); await submit(page);
  await page.getByRole("button", { name: "Comprobar incorporación" }).click();
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeDisabled();
  await page.evaluate(() => { window.intakeFixture.status = "applied"; });
  await page.getByRole("button", { name: "Comprobar incorporación" }).click();
  await expect(page.getByRole("status")).toContainText("Datos incorporados");
  await expect(page.getByRole("group", { name: "Incorporación pendiente", exact: true })).toHaveCount(0);
});

test("scope change invalidates delayed comparison and does not repopulate patient data", async ({ page }) => {
  await page.evaluate(() => { window.intakeFixture.delaySnapshot = true; });
  await page.getByRole("button", { name: "Consultar aportes", exact: true }).click();
  await page.getByRole("button", { name: "Comparar con la ficha" }).click();
  await page.evaluate(() => { window.intakeFixture.scope = "c".repeat(64); window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeEnabled();
  await page.evaluate(() => window.intakeFixture.releaseSnapshot());
  await expect(page.getByRole("region", { name: "Comparación con la ficha" })).toHaveCount(0);
  await expect(page.getByText("Marina Sintética", { exact: true })).toHaveCount(0);
});

test("patient/context mismatch refreshes state and allows a fresh comparison", async ({ page }) => {
  await page.getByRole("button", { name: "Consultar aportes", exact: true }).click();
  await page.evaluate(() => { window.intakeFixture.context = "d".repeat(64); });
  await page.getByRole("button", { name: "Comparar con la ficha" }).click();
  await expect(page.getByRole("status")).toContainText("paciente cambiaron");
  await compare(page);
});

test("revocation clears PII and rejects late comparison", async ({ page }) => {
  await compare(page);
  await page.evaluate(() => { window.intakeFixture.denied = true; window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("status")).toContainText("Acceso revocado");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Marina Sintética", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, hash: location.hash }))).toEqual({ local: 0, session: 0, hash: "" });
});

test("turno switch discards old comparison immediately and never restores late PII", async ({ page }) => {
  await page.evaluate(() => { window.intakeFixture.delaySnapshot = true; });
  await page.getByRole("button", { name: "Consultar aportes", exact: true }).click();
  await page.getByRole("button", { name: "Comparar con la ficha" }).click();
  await page.evaluate(() => window.changeTurnoFixture("44444444-4444-4444-8444-444444444444"));
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeEnabled();
  await page.evaluate(() => window.intakeFixture.releaseSnapshot());
  await expect(page.getByRole("region", { name: "Comparación con la ficha" })).toHaveCount(0);
  await expect(page.getByText("Marina Sintética", { exact: true })).toHaveCount(0);
});

test("unchanged and conflict are terminal messages with no new application", async ({ page }) => {
  for (const [action, message] of [["unchanged", "No hubo cambios"], ["conflict", "selección quedó pendiente"]]) {
    await page.evaluate(value => { window.intakeFixture.action = value; }, action);
    await compare(page); await submit(page);
    await expect(page.getByRole("status")).toContainText(message);
    await expect(page.getByRole("group", { name: "Incorporación pendiente", exact: true })).toHaveCount(0);
  }
});

test("desktop and mobile keyboard comparison has no overflow and labels remain accessible", async ({ page }, info) => {
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1280) await compare(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#6255C5");
    const checkbox = page.getByRole("checkbox", { name: /^Nombre/ });
    await checkbox.focus(); await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await page.keyboard.press("Space"); await expect(checkbox).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(checkbox).toHaveAccessibleName(/Actual en la ficha.*Marina Demo.*Aportado por el paciente.*Marina Sintética/);
    await page.screenshot({ path: info.outputPath(`comparison-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("checkbox", { name: /^Nombre/ })).toBeVisible();
});

test("conflict draft requires fresh comparison and another manual review with a new operation", async ({ page }, info) => {
  await page.evaluate(() => { window.intakeFixture.action = "conflict"; });
  await compare(page); await submit(page);
  const draft = page.getByRole("group", { name: "Selección pendiente de revisión" });
  await expect(draft).toContainText("Nombre"); await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Marina Sintética", { exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await draft.getByRole("button", { name: "Actualizar comparación" }).focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
    await expect(draft.getByRole("button", { name: "Actualizar comparación" })).toBeFocused();
    expect(await draft.getByRole("button", { name: "Actualizar comparación" }).evaluate(element => element.matches(":focus-visible") && parseFloat(getComputedStyle(element).outlineWidth) >= 2)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`conflict-draft-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => { window.intakeFixture.revision = "8"; window.intakeFixture.action = "applied"; });
  await draft.getByRole("button", { name: "Actualizar comparación" }).click();
  await expect(page.getByRole("checkbox", { name: /^Nombre/ })).toBeChecked();
  await expect(page.getByText(/Recuperamos las claves disponibles/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar incorporación", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.intakeFixture.operations.length)).toBe(1);
  await page.getByRole("button", { name: "Revisar selección" }).click();
  await page.getByRole("button", { name: "Confirmar incorporación", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Datos incorporados");
  const operations = await page.evaluate(() => window.intakeFixture.operations);
  expect(operations).toHaveLength(2); expect(operations[1].operationId).not.toBe(operations[0].operationId);
  expect(operations[1]).toMatchObject({ adminRevision: "8", selectedKeys: ["nombre"] });
});

test("fresh conflict comparison drops missing document pairs and changed identities", async ({ page }) => {
  await page.evaluate(() => { window.intakeFixture.action = "conflict"; });
  await compare(page); await page.getByRole("checkbox", { name: /^Documento/ }).check(); await submit(page);
  await page.evaluate(() => { window.intakeFixture.omitted = ["numeroDocumento"]; });
  await page.getByRole("button", { name: "Actualizar comparación" }).click();
  await expect(page.getByRole("checkbox", { name: /^Nombre/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Documento/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Documento/ })).toBeDisabled();
  await page.getByRole("button", { name: "Revisar selección" }).click(); await page.getByRole("button", { name: "Confirmar incorporación", exact: true }).click();
  await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toBeVisible();
  await page.evaluate(() => { window.intakeFixture.identityId = "55555555-5555-4555-8555-555555555555"; });
  await page.getByRole("button", { name: "Actualizar comparación" }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(page.getByText(/Recuperamos las claves disponibles/)).toHaveCount(0);
});

test("conflict draft is discarded on authority loss, scope ABA and unmount", async ({ page }) => {
  for (const invalidation of ["scope", "denied", "unmount"]) {
    await page.evaluate(() => { window.intakeFixture.action = "conflict"; window.intakeFixture.denied = false; });
    await compare(page); await submit(page);
    await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toBeVisible();
    if (invalidation === "unmount") { await page.evaluate(() => window.closeFixture()); await expect(page.getByText("Vista cerrada")).toBeVisible(); await page.evaluate(() => window.reopenFixture()); }
    else {
      await page.evaluate(kind => { if (kind === "denied") window.intakeFixture.denied = true; else window.intakeFixture.scope = "c".repeat(64); window.dispatchEvent(new Event("focus")); }, invalidation);
      await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toHaveCount(0);
      await page.evaluate(() => { window.intakeFixture.scope = "b".repeat(64); window.intakeFixture.denied = false; window.dispatchEvent(new Event("focus")); });
    }
    await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeEnabled();
    await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toHaveCount(0);
  }
});

test("late conflict and late refreshed snapshot cannot resurrect an invalidated draft", async ({ page }) => {
  await page.evaluate(() => { window.intakeFixture.action = "conflict"; window.intakeFixture.delayAction = true; });
  await compare(page); await submit(page);
  await page.evaluate(() => { window.intakeFixture.scope = "c".repeat(64); window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeEnabled();
  await page.evaluate(() => { window.intakeFixture.releaseAction(); window.intakeFixture.delayAction = false; });
  await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toHaveCount(0);
  await compare(page); await submit(page);
  await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toBeVisible();
  await page.evaluate(() => { window.intakeFixture.delaySnapshot = true; });
  await page.getByRole("button", { name: "Actualizar comparación" }).click();
  await page.evaluate(() => { window.intakeFixture.scope = "d".repeat(64); window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("button", { name: "Consultar aportes", exact: true })).toBeEnabled();
  await page.evaluate(() => window.intakeFixture.releaseSnapshot());
  await expect(page.getByRole("group", { name: "Selección pendiente de revisión" })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

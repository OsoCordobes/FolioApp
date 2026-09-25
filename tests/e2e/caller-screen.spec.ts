import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";

type Fixture = {
  browserCookies: { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None" }[];
  userId: string;
  databaseUrl: string;
  turnoId: string;
};

test("reception code, screen pairing, revocation and unchanged clinical state", async ({ browser, page }) => {
  test.setTimeout(180_000);
  if (process.env.FOLIO_TEST_REAL_SUPABASE !== "1" || process.env.CI !== "true") throw new Error("caller_proof_requires_isolated_ci");
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55421");
  const fixture = JSON.parse(await readFile(path.join(tmpdir(), "folio-caller-proof-fixture.json"), "utf8")) as Fixture;
  expect(fixture.userId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(fixture.browserCookies.length).toBeGreaterThan(0);
  await page.context().addCookies(fixture.browserCookies);
  const staffScreen = await page.request.get("http://localhost:4430/api/caller/screen");
  expect(staffScreen.status()).toBe(401);
  await page.goto("/configuracion");
  await expect(page.getByRole("link", { name: "Pantallas" })).toBeVisible();
  await page.getByRole("link", { name: "Pantallas" }).click();
  await expect(page.getByRole("heading", { name: "Pantallas de espera" })).toBeVisible();
  await page.getByRole("button", { name: "Generar código de vinculación" }).click();
  const code = (await page.locator(".caller-settings-code strong").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[a-f0-9]{16}$/);
  console.log("caller_proof_stage:pair_issued");

  const screen = await browser.newPage();
  await screen.addInitScript(() => {
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      const state = window as Window & { __folioCallerToneCount?: number };
      state.__folioCallerToneCount = (state.__folioCallerToneCount ?? 0) + 1;
      return start.apply(this, args);
    };
  });
  let reads = 0;
  screen.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/caller/screen") reads++; });
  await screen.goto("/pantalla");
  await expect(screen.getByRole("heading", { name: "Vinculá esta pantalla" })).toBeVisible();
  const beforePair = await screen.request.get("http://localhost:4430/api/caller/screen");
  expect(beforePair.status()).toBe(401);
  expect(beforePair.headers()["cache-control"]).toContain("no-store");
  const foreignOrigin = await screen.request.post("http://localhost:4430/api/caller/screen/pair", { headers: { Origin: "https://other.invalid", "Content-Type": "application/json" }, data: { code } });
  expect(foreignOrigin.status()).toBe(403);
  expect(foreignOrigin.headers()["access-control-allow-origin"]).toBeUndefined();
  await screen.getByLabel("Código de vinculación").fill(code);
  await screen.getByRole("button", { name: "Vincular pantalla" }).click();
  await expect(screen.getByText("Pantalla activa")).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Esperando llamados" })).toBeVisible();
  const screenCookies = await screen.context().cookies("http://localhost:4430/api/caller/screen");
  expect(screenCookies.some(cookie => cookie.name === "folio.caller_screen" && cookie.httpOnly && cookie.path === "/api/caller/screen")).toBe(true);
  expect(screenCookies.some(cookie => /auth-token/.test(cookie.name))).toBe(false);
  console.log("caller_proof_stage:screen_paired");

  await mkdir("test-results", { recursive: true });
  await page.reload();
  await expect(page.getByText("Activa", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/caller-settings-375.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/caller-settings-1440.png", fullPage: true });

  await page.goto("/hoy");
  const row = page.locator(".fi-turno").filter({ hasText: "Paciente sintético" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Código de espera y llamado" }).click();
  await row.getByRole("button", { name: "Entregar código" }).click();
  await expect(row.locator(".caller-control-code strong")).toHaveText("A0001");
  await page.setViewportSize({ width: 375, height: 812 });
  const panel = await row.locator(".caller-control-panel").boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(376);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(812);
  await expect(row.getByRole("button", { name: "Cerrar panel de llamado" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Cerrar panel de llamado" })).toBeFocused();
  const cookie = page.locator(".fi-cookie");
  if (await cookie.isVisible()) {
    const cookieBox = await cookie.boundingBox();
    expect(cookieBox).not.toBeNull();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(cookieBox!.y);
  }
  await page.screenshot({ path: "test-results/caller-hoy-375.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(row.locator(".caller-control-panel")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Código de espera y llamado" })).toBeFocused();
  await row.getByRole("button", { name: "Código de espera y llamado" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/caller-hoy-1440.png", fullPage: true });
  await row.getByRole("button", { name: "Cerrar panel de llamado" }).click();
  await expect(row.getByRole("button", { name: "Código de espera y llamado" })).toBeFocused();
  await row.getByRole("button", { name: "Código de espera y llamado" }).click();
  let lostResponse = false;
  const hoyActionPath = /\/hoy(?:\?.*)?$/;
  await page.route(hoyActionPath, async route => {
    if (!lostResponse && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      lostResponse = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await row.getByRole("button", { name: "Llamar código" }).click();
  await expect(row.getByRole("status")).toContainText("Comprobar llamado");
  expect(lostResponse).toBe(true);
  await page.unroute(hoyActionPath);
  await page.reload();
  const restored = page.locator(".fi-turno").filter({ hasText: "Paciente sintético" }).first();
  await restored.getByRole("button", { name: "Código de espera y llamado" }).click();
  await restored.getByRole("button", { name: "Entregar código" }).click();
  await expect(restored.getByRole("button", { name: "Comprobar llamado" })).toBeVisible();
  await restored.getByRole("button", { name: "Comprobar llamado" }).click();
  await expect(restored.getByRole("status")).toContainText("Llamado confirmado");
  await screen.bringToFront();
  await expect(screen.locator(".caller-call-list li").first()).toContainText("A0001");
  await expect(screen.locator(".caller-call-list li").first()).toContainText("Consultorio 1");
  await screen.setViewportSize({ width: 375, height: 812 });
  await screen.screenshot({ path: "test-results/caller-screen-375.png", fullPage: true });
  await screen.setViewportSize({ width: 1440, height: 900 });
  await screen.screenshot({ path: "test-results/caller-screen-1440.png", fullPage: true });
  console.log("caller_proof_stage:called_on_screen");

  const db = new Client({ connectionString: fixture.databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query("SELECT estado::text AS state FROM public.turno WHERE id=$1", [fixture.turnoId]);
    expect(rows[0]?.state).toBe("EN_SALA");
    const calls = await db.query("SELECT count(*)::int AS count FROM folio_caller_private.call_event WHERE turno_id=$1", [fixture.turnoId]);
    expect(calls.rows[0]?.count).toBe(1);
  } finally { await db.end(); }
  console.log("caller_proof_stage:lost_response_reused");
  console.log("caller_proof_stage:visit_unchanged");

  // Five-second visible cadence; hidden windows make no requests. Resuming
  // clears stale pixels and reconnects once without replaying an old call.
  const before = reads;
  await screen.waitForTimeout(11_000);
  const visibleReads = reads - before;
  expect(visibleReads).toBeGreaterThanOrEqual(1);
  expect(visibleReads).toBeLessThanOrEqual(4);
  await screen.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  const hiddenBefore = reads;
  await screen.waitForTimeout(6500);
  expect(reads).toBe(hiddenBefore);
  await screen.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(screen.locator(".caller-call-list li").first()).toContainText("A0001");
  console.log(`caller_proof_stage:polling_bounded visible_11s=${visibleReads} hidden_6s=0`);

  await screen.getByRole("button", { name: "Activar sonido" }).click();
  await expect(screen.getByRole("button", { name: "Sonido activado" })).toBeVisible();
  const tonesBefore = await screen.evaluate(() => (window as Window & { __folioCallerToneCount?: number }).__folioCallerToneCount ?? 0);
  let interrupted = false;
  await screen.route("**/api/caller/screen*", async route => {
    if (!interrupted) {
      interrupted = true;
      await route.fulfill({ status: 503, headers: { "Cache-Control": "no-store" }, body: "{}" });
    } else await route.continue();
  });
  await expect(screen.getByText("Sin conexión · Reintentando")).toBeVisible({ timeout: 12_000 });
  await expect(screen.locator(".caller-call-list li")).toHaveCount(0);
  await expect(screen.getByText("Pantalla activa")).toBeVisible({ timeout: 20_000 });
  await expect(screen.locator(".caller-call-list li").first()).toContainText("A0001");
  expect(await screen.evaluate(() => (window as Window & { __folioCallerToneCount?: number }).__folioCallerToneCount ?? 0)).toBe(tonesBefore);
  await screen.unroute("**/api/caller/screen*");
  console.log("caller_proof_stage:reconnect_silent");

  await page.goto("/configuracion/pantallas");
  await expect(page.getByText("Activa", { exact: true })).toBeVisible();
  page.once("dialog", dialog => void dialog.accept());
  await page.getByRole("button", { name: "Desconectar" }).first().click();
  await expect(page.getByText("Desconectada", { exact: true })).toBeVisible();
  await screen.bringToFront();
  await expect(screen.getByRole("heading", { name: "Vinculá esta pantalla" })).toBeVisible();
  console.log("caller_proof_stage:revoked_after_reload");
  await screen.close();
});

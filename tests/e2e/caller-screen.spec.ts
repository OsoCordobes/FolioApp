import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";

import { DIAGNOSTIC_PREFIX, STAGE_PREFIX } from "../../scripts/testing/caller-proof/markers";

type Fixture = {
  browserCookies: { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None" }[];
  userId: string;
  databaseUrl: string;
  turnoId: string;
};

function pairMessageKind(message: string) {
  const labels: Record<string, string> = {
    "Ingresá este código en la pantalla. Vence en cinco minutos y se usa una sola vez.": "issued",
    "El código ya se emitió. Generá uno nuevo.": "already_issued",
    "No tenés permiso para esta acción.": "permission",
    "Error obteniendo membresía.": "membership",
    "No tenés acceso a ninguna organización todavía.": "membership",
    "No estás autenticado.": "mfa_session",
    "Volvé a iniciar sesión.": "mfa_session",
    "Completá la verificación en dos pasos para continuar.": "mfa_session",
    "No pudimos verificar la seguridad de tu sesión. Reintentá.": "mfa_session",
    "No pudimos confirmar el guardado. Revisá el estado antes de volver a intentar.": "uncertain_write",
    "No pudimos confirmar la respuesta. Comprobá la misma operación antes de emitir otra.": "uncertain_write",
    "No pudimos confirmar la vinculación. Generá un código nuevo; el anterior quedará invalidado.": "uncertain_write",
    "Se interrumpió la conexión. Revisá el estado antes de volver a intentar.": "network",
    "No pudimos leer la pantalla.": "network",
    "Operación inválida.": "validation",
    "Revisá los datos del llamado.": "validation",
    "Esta operación corresponde a otro llamado. Actualizá la vista.": "validation",
    "Primero entregá un código de espera.": "validation",
    "Esperá un momento antes de repetir esta acción.": "rate_limit",
  };
  return labels[message.trim()] ?? (message ? "unmapped" : "none");
}

test("reception code, screen pairing, revocation and unchanged clinical state", async ({ browser, page }) => {
  test.setTimeout(420_000);
  const startedAt = Date.now();
  const timedStage = (stage: string, extra: Record<string, number> = {}) =>
    console.log(`${STAGE_PREFIX}${JSON.stringify({ stage, elapsedMs: Date.now() - startedAt, ...extra })}`);
  timedStage("test_started");
  if (process.env.FOLIO_TEST_REAL_SUPABASE !== "1" || process.env.CI !== "true") throw new Error("caller_proof_requires_isolated_ci");
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55421");
  const fixture = JSON.parse(await readFile(path.join(tmpdir(), "folio-caller-proof-fixture.json"), "utf8")) as Fixture;
  expect(fixture.userId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(fixture.browserCookies.length).toBeGreaterThan(0);
  const beforeHydration = await browser.newContext({ javaScriptEnabled: false });
  try {
    await beforeHydration.addCookies(fixture.browserCookies);
    const serverPage = await beforeHydration.newPage();
    await serverPage.goto("http://localhost:4430/configuracion/pantallas");
    await expect(serverPage.getByRole("button", { name: "Generar código de vinculación" })).toBeDisabled();
  } finally { await beforeHydration.close(); }
  timedStage("ssr_control_disabled");
  await page.context().addCookies(fixture.browserCookies);
  const staffScreen = await page.request.get("http://localhost:4430/api/caller/screen");
  expect(staffScreen.status()).toBe(401);
  await page.goto("/configuracion");
  await expect(page.getByRole("link", { name: "Pantallas" })).toBeVisible();
  await page.getByRole("link", { name: "Pantallas" }).click();
  await expect(page.getByRole("heading", { name: "Pantallas de espera" })).toBeVisible();
  timedStage("settings_loaded");
  let pairRequest: import("@playwright/test").Request | null = null;
  let pairActionId: string | null = null;
  let pairActionCount = 0;
  let pairAction: "none" | "pending" | "complete" | "failed" = "none";
  let pairStatus: "none" | "2xx" | "3xx" | "4xx" | "5xx" = "none";
  page.on("request", request => {
    const actionId = request.headers()["next-action"];
    if (request.method() !== "POST" || !actionId ||
        new URL(request.url()).pathname !== "/configuracion/pantallas") return;
    if (!pairActionId) { pairRequest = request; pairActionId = actionId; pairAction = "pending"; }
    if (actionId === pairActionId) pairActionCount++;
  });
  page.on("response", response => {
    if (response.request() !== pairRequest) return;
    const status = response.status();
    pairStatus = status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : "2xx";
  });
  page.on("requestfinished", request => { if (request === pairRequest) pairAction = "complete"; });
  page.on("requestfailed", request => { if (request === pairRequest) pairAction = "failed"; });
  timedStage("pair_requested");
  const pairButton = page.getByRole("button", { name: "Generar código de vinculación" });
  const pairingControl = page.locator(".caller-settings-card").first().locator("button").first();
  const codeLabel = page.locator(".caller-settings-code strong");
  try {
    await pairButton.click({ timeout: 30_000 });
    timedStage("pair_click_returned");
    await expect(codeLabel).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const button = await pairingControl.count() > 0 ? await pairingControl.isEnabled() ? "enabled" : "disabled" : "missing";
    const message = (await page.locator(".caller-settings-message[role='status']").first().textContent({ timeout: 500 }).catch(() => null)) ?? "";
    const code = await codeLabel.isVisible().catch(() => false) ? "present" : "absent";
    console.log(`${DIAGNOSTIC_PREFIX}${JSON.stringify({ kind: "pair", action: pairAction, status: pairStatus, button, message: pairMessageKind(message), code })}`);
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/caller-pair-failure.png", fullPage: false,
      mask: [page.locator(".caller-settings-code"), page.locator("strong"), page.locator("input"), page.locator("img"), page.locator("canvas"), page.locator("details"), page.locator("nextjs-portal")],
      maskColor: "#1d1d1d", timeout: 5_000 }).catch(() => {});
    throw error;
  }
  const code = (await codeLabel.textContent({ timeout: 5_000 }))?.trim() ?? "";
  if (!/^[a-f0-9]{16}$/.test(code)) throw new Error("pair_code_format_invalid");
  expect(pairActionCount).toBe(1);
  expect(pairStatus).toBe("2xx");
  await expect.poll(() => pairAction, { timeout: 5_000 }).toBe("complete");
  timedStage("pair_issued");

  timedStage("screen_context_requested");
  const screen = await browser.newPage();
  timedStage("screen_context_created");
  await screen.addInitScript(() => {
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      const state = window as Window & { __folioCallerToneCount?: number };
      state.__folioCallerToneCount = (state.__folioCallerToneCount ?? 0) + 1;
      return start.apply(this, args);
    };
  });
  timedStage("screen_script_ready");
  let reads = 0;
  screen.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/caller/screen") reads++; });
  timedStage("screen_open");
  await screen.goto("/pantalla");
  await expect(screen.getByRole("heading", { name: "Vinculá esta pantalla" })).toBeVisible();
  timedStage("screen_ready");
  const beforePair = await screen.request.get("http://localhost:4430/api/caller/screen");
  expect(beforePair.status()).toBe(401);
  expect(beforePair.headers()["cache-control"]).toContain("no-store");
  const foreignOrigin = await screen.request.post("http://localhost:4430/api/caller/screen/pair", { headers: { Origin: "https://other.invalid", "Content-Type": "application/json" }, data: { code } });
  expect(foreignOrigin.status()).toBe(403);
  expect(foreignOrigin.headers()["access-control-allow-origin"]).toBeUndefined();
  await screen.getByLabel("Código de vinculación").fill(code);
  timedStage("screen_pair_requested");
  await screen.getByRole("button", { name: "Vincular pantalla" }).click();
  timedStage("pair_submitted");
  await expect(screen.getByText("Pantalla activa")).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Esperando llamados" })).toBeVisible();
  const screenCookies = await screen.context().cookies("http://localhost:4430/api/caller/screen");
  expect(screenCookies.some(cookie => cookie.name === "folio.caller_screen" && cookie.httpOnly && cookie.path === "/api/caller/screen")).toBe(true);
  expect(screenCookies.some(cookie => /auth-token/.test(cookie.name))).toBe(false);
  timedStage("screen_paired");

  await mkdir("test-results", { recursive: true });
  await page.reload();
  await expect(page.locator(".caller-settings-list li").filter({ hasText: "Activa" }).first().getByText("Activa", { exact: true })).toBeVisible();
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
  timedStage("called_on_screen");

  const db = new Client({ connectionString: fixture.databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query("SELECT estado::text AS state FROM public.turno WHERE id=$1", [fixture.turnoId]);
    expect(rows[0]?.state).toBe("EN_SALA");
    const calls = await db.query("SELECT count(*)::int AS count FROM folio_caller_private.call_event WHERE turno_id=$1", [fixture.turnoId]);
    expect(calls.rows[0]?.count).toBe(1);
  } finally { await db.end(); }
  timedStage("lost_response_reused");
  timedStage("visit_unchanged");

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
  timedStage("polling_bounded", { visible11s: visibleReads, hidden6s: 0 });

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
  timedStage("reconnect_silent");

  await page.goto("/configuracion/pantallas");
  await expect(page.locator(".caller-settings-list li").filter({ hasText: "Activa" }).first().getByText("Activa", { exact: true })).toBeVisible();
  page.once("dialog", dialog => void dialog.accept());
  await page.getByRole("button", { name: "Desconectar" }).first().click();
  await expect(page.locator(".caller-settings-list li").filter({ hasText: "Desconectada" }).first().getByText("Desconectada", { exact: true })).toBeVisible();
  await screen.bringToFront();
  await expect(screen.getByRole("heading", { name: "Vinculá esta pantalla" })).toBeVisible();
  timedStage("revoked_after_reload");
  await screen.close();
});

import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";

import { totp } from "../../scripts/testing/clinical-config.mjs";

type Fixture = { email: string; password: string; totpSecret: string; enrollmentOtpWindow: number; databaseUrl: string; turnoId: string };

function mfaAlertKind(message: string) {
  const known: Record<string, string> = {
    "Ingresá los 6 números de tu autenticador.": "validation",
    "Volvé a iniciar sesión.": "session",
    "No pudimos verificar tu sesión. Reintentá.": "session_check",
    "Hubo demasiados intentos. Esperá antes de volver a probar.": "rate",
    "No pudimos consultar tus dispositivos. Reintentá.": "factor_list",
    "No encontramos ese dispositivo en tu cuenta.": "factor_missing",
    "No pudimos iniciar la verificación. Reintentá en unos instantes.": "challenge",
    "El código no es válido o venció. Ingresá el código actual de tu autenticador.": "otp",
    "No pudimos verificar la seguridad de tu sesión. Reintentá.": "policy_read",
    "Completá la verificación en dos pasos para continuar.": "policy",
    "No pudimos verificar el código. Reintentá.": "network",
  };
  return known[message.trim()] ?? (message ? "unknown" : "none");
}

async function browserMfaReadProbe(page: import("@playwright/test").Page, expectedEmail: string) {
  const empty = "shape=none required=none staff=none factor=none allowed=none session=none rpc_code=none";
  const cookies = await page.context().cookies("http://localhost:4430");
  const base = cookies.find(cookie => /^sb-[a-z0-9-]+-auth-token$/.test(cookie.name));
  const key = base?.name ?? cookies.find(cookie => /^sb-[a-z0-9-]+-auth-token\.0$/.test(cookie.name))?.name.slice(0, -2);
  if (!key) return `cookie=missing auth=none same=0 aal=none rpc=none ${empty}`;
  const chunks = cookies.filter(cookie => cookie.name.startsWith(`${key}.`))
    .sort((a, b) => Number(a.name.slice(key.length + 1)) - Number(b.name.slice(key.length + 1)));
  if (!base && chunks.some((cookie, index) => cookie.name !== `${key}.${index}`))
    return `cookie=chunk_gap auth=none same=0 aal=none rpc=none ${empty}`;
  const serialized = base?.value ?? chunks.map(cookie => cookie.value).join("");
  let accessToken: string | undefined;
  try {
    const json = serialized.startsWith("base64-") ? Buffer.from(serialized.slice(7), "base64url").toString("utf8") : serialized;
    const session = JSON.parse(json) as { access_token?: unknown };
    if (session && typeof session === "object" && typeof session.access_token === "string") accessToken = session.access_token;
  } catch { /* Cookie data stays private, even on a malformed value. */ }
  if (!accessToken) return `cookie=invalid auth=none same=0 aal=none rpc=none ${empty}`;
  const api = process.env.FOLIO_TEST_SUPABASE_URL;
  const anon = process.env.FOLIO_TEST_SUPABASE_ANON_KEY;
  if (api !== "http://127.0.0.1:55421" || !anon) return `cookie=valid auth=config same=0 aal=none rpc=none ${empty}`;
  let aal = "other";
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { aal?: unknown };
    aal = claims.aal === "aal1" || claims.aal === "aal2" ? claims.aal : "other";
  } catch { aal = "invalid"; }
  const headers = { apikey: anon, Authorization: `Bearer ${accessToken}` };
  let auth = "transport", same = 0, rpc = "none", shape = "none", rpcCode = "none";
  let required = "none", staff = "none", factor = "none", allowed = "none", session = "none";
  try {
    const response = await fetch(`${api}/auth/v1/user`, { headers, signal: AbortSignal.timeout(5000) });
    auth = response.ok ? "valid" : response.status === 401 ? "unauthorized" : "http_other";
    if (response.ok) {
      try {
        const user = await response.json() as { email?: unknown };
        same = user.email === expectedEmail ? 1 : 0;
      } catch { auth = "format"; }
    }
  } catch { auth = "transport"; }
  try {
    const response = await fetch(`${api}/rest/v1/rpc/mfa_access_status`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000),
    });
    rpc = response.ok ? "ok" : response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status >= 500 ? "server" : "http_other";
    if (response.ok) {
      try {
        const data = await response.json() as Record<string, unknown>;
        const keys = ["required", "allowed", "isStaff", "hasVerifiedFactor", "sessionValid"];
        shape = data && typeof data === "object" && keys.every(key => typeof data[key] === "boolean") ? "valid" : "invalid";
        if (shape === "valid") {
          required = data.required === true ? "1" : "0";
          staff = data.isStaff === true ? "1" : "0";
          factor = data.hasVerifiedFactor === true ? "1" : "0";
          allowed = data.allowed === true ? "1" : "0";
          session = data.sessionValid === true ? "1" : "0";
        }
      } catch { shape = "invalid"; }
    } else {
      try {
        const data = await response.json() as { code?: unknown };
        const code = data && typeof data === "object" ? data.code : null;
        rpcCode = ["42501", "42883", "42P01", "42703", "PGRST202", "PGRST301", "PGRST302", "PGRST303"].includes(String(code)) ? String(code) : "other";
      } catch { rpcCode = "other"; }
    }
  } catch { rpc = "transport"; }
  return `cookie=valid auth=${auth} same=${same} aal=${aal} rpc=${rpc} shape=${shape} required=${required} staff=${staff} factor=${factor} allowed=${allowed} session=${session} rpc_code=${rpcCode}`;
}

test("reception code, screen pairing, revocation and unchanged clinical state", async ({ browser, page }) => {
  test.setTimeout(180_000);
  if (process.env.FOLIO_TEST_REAL_SUPABASE !== "1" || process.env.CI !== "true") throw new Error("caller_proof_requires_isolated_ci");
  const fixture = JSON.parse(await readFile(path.join(tmpdir(), "folio-caller-proof-fixture.json"), "utf8")) as Fixture;
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(fixture.email);
  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole("button", { name: "Ingresar a Folio" }).click();
  await page.waitForURL(/\/seguridad\/mfa|\/hoy/);
  if (new URL(page.url()).pathname === "/seguridad/mfa") {
    let postRequest: import("@playwright/test").Request | null = null;
    let postState = "none", postStatus = "none";
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/seguridad/mfa") {
        postRequest = request; postState = "pending";
      }
    });
    page.on("response", response => {
      if (response.request() === postRequest) {
        const status = response.status();
        postStatus = status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : "2xx";
      }
    });
    page.on("requestfinished", request => { if (request === postRequest) postState = "complete"; });
    page.on("requestfailed", request => { if (request === postRequest) postState = "failed"; });
    const sameWindow = Math.floor(Date.now() / 30_000) <= fixture.enrollmentOtpWindow;
    console.log(`caller_proof_mfa_preflight:same_window=${sameWindow ? 1 : 0}`);
    // The setup ceremony already consumed its OTP. Use a fresh time step,
    // and leave enough time for the browser action to reach GoTrue.
    if (sameWindow || Date.now() % 30_000 > 23_000) {
      const nextWindow = Math.max(fixture.enrollmentOtpWindow + 1, Math.floor(Date.now() / 30_000) + 1);
      await page.waitForTimeout(nextWindow * 30_000 - Date.now() + 1_000);
    }
    await page.getByLabel("Código de seis números").fill(totp(fixture.totpSecret));
    await page.getByRole("button", { name: "Verificar código" }).click();
    // First Server Action compilation in dev can outlast Playwright's short
    // assertion timeout. Observe the POST to completion before checking UI.
    await expect.poll(() => postState, { timeout: 30_000 }).toMatch(/^(complete|failed)$/).catch(() => {});
    try {
      await expect(page.getByRole("heading", { name: "Verificación completada" })).toBeVisible({ timeout: 10_000 });
    } catch (error) {
      const formAlerts = page.locator(".au-form-inner p[role='alert']");
      const formCount = await formAlerts.count();
      const allCount = await page.getByRole("alert").count();
      const alert = (await formAlerts.first().textContent({ timeout: 500 }).catch(() => null)) ?? "";
      const kind = mfaAlertKind(alert);
      const pathname = new URL(page.url()).pathname;
      const button = await page.getByRole("button", { name: "Verificando…" }).count() > 0 ? "pending"
        : await page.getByRole("button", { name: "Verificar código" }).count() > 0 ? "ready" : "missing";
      const routeAnnouncer = await page.locator("next-route-announcer").count() > 0;
      console.log(`caller_proof_mfa_diagnostic:path=${pathname === "/seguridad/mfa" ? "mfa" : pathname === "/hoy" ? "hoy" : "other"} alert=${kind} form=${formCount > 0 ? 1 : 0} outside=${allCount > formCount ? 1 : 0} announcer=${routeAnnouncer ? 1 : 0} button=${button} post=${postState} status=${postStatus}`);
      await page.screenshot({ path: "test-results/caller-mfa-failure.png", fullPage: false,
        mask: [page.locator("input"), page.locator("img"), page.locator("details"), page.locator("canvas"), page.locator("nextjs-portal")],
        maskColor: "#1d1d1d", timeout: 5_000 }).catch(() => {});
      console.log(`caller_proof_mfa_read_probe:${await browserMfaReadProbe(page, fixture.email)}`);
      throw error;
    }
    await page.getByRole("link", { name: "Continuar" }).first().click();
  }
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

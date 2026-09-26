import { test, expect } from "@playwright/test";

const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);
const markerA = "1".repeat(64);
const markerB = "2".repeat(64);

test("desktop: fragment disappears, keyboard form keeps its draft after a lost response", async ({ page }) => {
  await page.route("**/api/patient-intake/exchange", async route => {
    expect(route.request().postDataJSON()).toEqual({ token: tokenA });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "set-cookie": `folio.intake.session=${tokenA}; Path=/api/patient-intake; HttpOnly; SameSite=Strict` }, body: JSON.stringify({ ok: true, marker: markerA, expiresAt: "2026-09-27T20:00:00Z" }) });
  });
  let operation = "";
  let checked = false;
  await page.route("**/api/patient-intake/submit", async route => {
    const body = route.request().postDataJSON();
    expect(body.marker).toBe(markerA);
    expect(body.answers).toEqual({ nombre: "Ana" });
    operation = body.operationId;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, status: "uncertain" }) });
  });
  await page.route("**/api/patient-intake/status", async route => {
    const body = route.request().postDataJSON();
    expect(body.marker).toBe(markerA);
    if (!checked) { checked = true; operation = body.operationId; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "not_received" }) }); }
    else { expect(body.operationId).toBe(operation); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "received", receiptId: "11111111-1111-4111-8111-111111111111", receivedAt: "2026-09-26T19:00:00Z" }) }); }
  });
  await page.goto(`/aporte#token=${tokenA}`);
  await expect(page).toHaveURL(/\/aporte$/);
  await expect(page.getByRole("heading", { name: "Compartí tus datos con el consultorio" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Cookies y privacidad" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Privacidad" })).toHaveAttribute("href", "/privacidad");
  await expect(page.getByRole("link", { name: "Cookies" })).toHaveAttribute("href", "/cookies");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Ana");
  await page.getByRole("button", { name: "Enviar datos" }).click();
  await expect(page.getByText(/No pudimos confirmar la recepción/).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Ana");
  await page.getByRole("button", { name: "Consultar estado de este envío" }).click();
  await expect(page.getByText("Aporte recibido")).toBeVisible();
});

test("mobile: another tab replacing the cookie leaves the first draft uncertain", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/patient-intake/exchange", async route => {
    const token = route.request().postDataJSON().token;
    const marker = token === tokenA ? markerA : markerB;
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "set-cookie": `folio.intake.session=${token}; Path=/api/patient-intake; HttpOnly; SameSite=Strict` }, body: JSON.stringify({ ok: true, marker }) });
  });
  await page.goto(`/aporte#token=${tokenA}`);
  await expect(page.getByRole("heading", { name: "Compartí tus datos con el consultorio" })).toBeVisible();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Ana");
  const second = await context.newPage();
  await second.route("**/api/patient-intake/exchange", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "set-cookie": `folio.intake.session=${tokenB}; Path=/api/patient-intake; HttpOnly; SameSite=Strict` }, body: JSON.stringify({ ok: true, marker: markerB }) });
  });
  await second.goto(`/aporte#token=${tokenB}`);
  await expect(second.getByRole("button", { name: "Enviar datos" })).toBeVisible();
  let transmitted = false;
  await page.route("**/api/patient-intake/submit", async route => {
    transmitted = true;
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });
  await page.route("**/api/patient-intake/status", async route => {
    expect(route.request().postDataJSON().marker).toBe(markerA);
    expect(route.request().headers().cookie).toContain(tokenB);
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });
  await page.getByRole("button", { name: "Enviar datos" }).click();
  expect(transmitted).toBe(false);
  await expect(page.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Ana");
  await expect(page.getByText(/Tus datos siguen en esta pantalla/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("revocation during submission remains uncertain and keeps answers", async ({ page }) => {
  await page.route("**/api/patient-intake/exchange", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, marker: markerA }) });
  });
  let statusReads = 0;
  await page.route("**/api/patient-intake/status", async route => {
    statusReads++;
    await route.fulfill({ status: statusReads === 1 ? 200 : 503, contentType: "application/json", body: JSON.stringify(statusReads === 1 ? { ok: true, status: "not_received" } : { ok: false, status: "uncertain" }) });
  });
  await page.route("**/api/patient-intake/submit", async route => {
    expect(route.request().postDataJSON().answers).toEqual({ nombre: "Ana" });
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, status: "uncertain" }) });
  });
  await page.goto(`/aporte#token=${tokenA}`);
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Ana");
  await page.getByRole("button", { name: "Enviar datos" }).click();
  await page.getByRole("button", { name: "Consultar estado de este envío" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Ana");
  await expect(page.getByRole("button", { name: "Consultar estado de este envío" })).toBeVisible();
  await expect(page.getByText(/Consultá con el consultorio antes de repetir/)).toBeVisible();
});

test("provisional not_received only retries the identical operation and frozen payload", async ({ page }) => {
  await page.route("**/api/patient-intake/exchange", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, marker: markerA }) });
  });
  await page.route("**/api/patient-intake/status", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "not_received" }) });
  });
  const submitted: { operationId: string; answers: unknown }[] = [];
  await page.route("**/api/patient-intake/submit", async route => {
    const body = route.request().postDataJSON();
    submitted.push({ operationId: body.operationId, answers: body.answers });
    if (submitted.length === 1) {
      // The first request may still be committing after this response is lost.
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, status: "uncertain" }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "received", receiptId: "11111111-1111-4111-8111-111111111111", receivedAt: "2026-09-26T19:00:00Z" }) });
    }
  });
  await page.goto(`/aporte#token=${tokenA}`);
  const name = page.getByRole("textbox", { name: "Nombre", exact: true });
  await name.fill("Ana");
  await page.getByRole("button", { name: "Enviar datos" }).click();
  await page.getByRole("button", { name: "Consultar estado de este envío" }).click();
  await expect(name).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enviar datos" })).toHaveCount(0);
  await page.getByRole("button", { name: "Reenviar los mismos datos" }).click();
  await expect(page.getByText("Aporte recibido")).toBeVisible();
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
});

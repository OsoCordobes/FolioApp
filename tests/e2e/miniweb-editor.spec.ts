import { expect, test } from "../fixtures/local-test";

const mapUrl = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d123.45!2sAv.%20C%C3%B3rdoba%20123";

test("miniweb editor previews a validated map before address confirmation", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* private browsing */ }
  });
  await page.route("https://www.google.com/maps/embed**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<html><meta charset='utf-8'><body style='font:16px Arial;background:#eee9ff;color:#292143;padding:28px'>Mapa de prueba: marcador ficticio</body></html>" });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/experience?panel=configuracion&editing=1");
  const location = page.locator("#cfg-ubicacion");
  const mapRow = location.locator(".cfg-row").filter({ hasText: "Mapa de Google" });
  const paste = page.getByRole("textbox", { name: "Código para insertar mapa de Google" });
  const confirm = page.getByRole("button", { name: "Confirmar mapa" });
  await expect(paste).toHaveAttribute("placeholder", "Pegá lo que copiaste de Google Maps");
  await paste.fill('<iframe src="https://evil.test/maps/embed?pb=!1m18!1m12!1m3!1d123.45"></iframe>');
  await expect(location.getByRole("alert")).toContainText("no parece ser");
  await expect(location.locator(".miniweb-map-preview iframe")).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await paste.fill(`<iframe src="${mapUrl}" width="600" height="450"></iframe>`);
  await expect(location.getByRole("alert")).toHaveCount(0);
  await expect(location.locator(".miniweb-map-preview iframe")).toHaveAttribute("src", mapUrl);
  await expect(confirm).toBeDisabled();
  await location.getByRole("checkbox", { name: /Confirmo que este mapa/ }).check();
  await expect(confirm).toBeEnabled();
  await mapRow.screenshot({ path: testInfo.outputPath("d06b-map-editor-desktop-1440.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await mapRow.screenshot({ path: testInfo.outputPath("d06b-map-editor-mobile-375.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

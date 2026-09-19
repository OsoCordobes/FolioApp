import { expect, test } from "../fixtures/local-test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* private browsing */ }
  });
});

test("an interrupted recovery request keeps the email and offers an honest retry", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  let posts = 0;
  await page.route((url) => url.origin === origin && url.pathname === "/login", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 503, body: "synthetic interrupted response" });
    } else {
      await route.continue();
    }
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "¿La olvidaste?" }).click();
  await expect(page.getByRole("heading", { name: "Recuperá tu acceso." })).toBeVisible();
  const email = page.getByRole("textbox", { name: "Email de tu cuenta" });
  await email.fill("recuperacion@example.test");
  await page.getByRole("button", { name: "Enviar enlace de recuperación" }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect.poll(() => posts).toBe(1);
  await expect(page.locator("#fx-forgot-error")).toContainText("No pudimos confirmar el envío");
  await expect(email).toHaveValue("recuperacion@example.test");
  await expect(page.getByRole("heading", { name: "Revisá tu email." })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enviar enlace de recuperación" })).toBeEnabled();
});

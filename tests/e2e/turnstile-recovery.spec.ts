import { expect, test, type Page } from "../fixtures/local-test";

const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const challengeAlert = "div.onb-err[role=alert]";
const syntheticApi = `
  window.__turnstileStats = { renders: 0, removes: 0 };
  window.turnstile = {
    render(_container, options) {
      window.__turnstileStats.renders++;
      window.__turnstileCallbacks = options;
      queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX'));
      return String(window.__turnstileStats.renders);
    },
    remove() { window.__turnstileStats.removes++; },
    reset() {},
  };
`;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* private browsing */ }
  });
});

async function openOnboardingSignup(page: Page) {
  await page.goto("/onboarding");
  await page.getByRole("radio", { name: /Profesional independiente/ }).check();
  await page.getByRole("button", { name: "Seguir con esta opción" }).click();
}

test("blocked script offers retry without losing signup fields", async ({ page }) => {
  let requests = 0;
  await page.route(scriptUrl, async (route) => {
    requests++;
    if (requests === 1) await route.abort("blockedbyclient");
    else await route.fulfill({ status: 200, contentType: "application/javascript", body: syntheticApi });
  });
  await openOnboardingSignup(page);
  await page.getByRole("textbox", { name: "Email" }).fill("synthetic@example.test");
  await page.getByPlaceholder("Mínimo 8 caracteres").fill("synthetic-password-only");
  await page.getByRole("checkbox").first().check();
  await expect(page.locator(challengeAlert)).toContainText("No pudimos cargar la verificación", { timeout: 15_000 });
  await page.getByRole("button", { name: "Reintentar verificación" }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator(challengeAlert)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("synthetic@example.test");
  await expect(page.getByPlaceholder("Mínimo 8 caracteres")).toHaveValue("synthetic-password-only");
  await expect(page.getByRole("checkbox").first()).toBeChecked();
});

test("challenge error and expiry require a fresh token and support manual retry", async ({ page }) => {
  await page.route(scriptUrl, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: syntheticApi }));
  await openOnboardingSignup(page);
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __turnstileCallbacks?: unknown }).__turnstileCallbacks))).toBe(true);
  await page.evaluate(() => (window as unknown as Window & { __turnstileCallbacks: { "error-callback": (code: string) => void } }).__turnstileCallbacks["error-callback"]("200500"));
  await expect(page.locator(challengeAlert)).toContainText("Código 200500");
  await page.getByRole("button", { name: "Reintentar verificación" }).click();
  await expect(page.locator(challengeAlert)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __turnstileStats: { renders: number } }).__turnstileStats.renders)).toBe(2);
  await page.evaluate(() => (window as unknown as Window & { __turnstileCallbacks: { "expired-callback": () => void } }).__turnstileCallbacks["expired-callback"]());
  await expect(page.locator(challengeAlert)).toContainText("venció");
  await page.getByRole("button", { name: "Reintentar verificación" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __turnstileStats: { renders: number } }).__turnstileStats.renders)).toBe(3);
  const stats = await page.evaluate(() => (window as unknown as Window & { __turnstileStats: { renders: number; removes: number } }).__turnstileStats);
  expect(stats.renders).toBe(3);
  expect(stats.removes).toBe(2);
});

test("el ingreso antiguo monta el widget sólo después de elegir modalidad", async ({ page }) => {
  await page.route(scriptUrl, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: syntheticApi }));
  await page.goto("/login");
  await page.getByRole("button", { name: /crear cuenta/i }).first().click();
  await expect(page.getByRole("link", { name: /Elegir modalidad/ })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __turnstileStats?: unknown }).__turnstileStats)).toBeUndefined();
  await page.getByRole("link", { name: /Elegir modalidad/ }).click();
  await page.getByRole("radio", { name: /Profesional independiente/ }).check();
  await page.getByRole("button", { name: "Seguir con esta opción" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __turnstileStats?: { renders: number } }).__turnstileStats?.renders)).toBe(1);
  await page.getByRole("button", { name: /Atrás/ }).click();
  await page.getByRole("button", { name: "Seguir con esta opción" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __turnstileStats?: { renders: number } }).__turnstileStats?.renders)).toBe(2);
});

test("a widget render failure is visible and can be retried", async ({ page }) => {
  const throwsOnce = syntheticApi.replace(
    "window.__turnstileStats.renders++;",
    "window.__turnstileStats.renders++; if (window.__turnstileStats.renders === 1) throw Error('synthetic render failure');",
  );
  await page.route(scriptUrl, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: throwsOnce }));
  await openOnboardingSignup(page);
  await expect(page.locator(challengeAlert)).toContainText("No se pudo completar la verificación");
  await page.getByRole("button", { name: "Reintentar verificación" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __turnstileStats: { renders: number } }).__turnstileStats.renders)).toBe(2);
  await expect(page.locator(challengeAlert)).toHaveCount(0);
});

test("a double click submits the onboarding signup at most once", async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL!).origin;
  await page.route(scriptUrl, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: syntheticApi }));
  let posts = 0;
  await page.route((url) => url.origin === appOrigin && url.pathname === "/onboarding", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 503, body: "synthetic failed response" });
    } else await route.continue();
  });
  await openOnboardingSignup(page);
  await page.getByRole("textbox", { name: "Email" }).fill("double-click@example.test");
  await page.getByPlaceholder("Mínimo 8 caracteres").fill("synthetic-password-only");
  await page.getByRole("checkbox").first().check();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __turnstileCallbacks?: unknown }).__turnstileCallbacks))).toBe(true);
  await page.getByRole("button", { name: "Continuar", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByText(/No pudimos confirmar si la cuenta se creó/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __turnstileStats: { renders: number } }).__turnstileStats.renders)).toBe(2);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("double-click@example.test");
});

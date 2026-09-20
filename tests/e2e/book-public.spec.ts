import { expect, test } from "../fixtures/local-test";

/**
 * Folio · /dev/book-preview · BookLanding + booking flow — Playwright e2e.
 *
 * Drives /dev/book-preview (mock data shape identical to /book/[slug]).
 * Verifies the doctor-first landing integration:
 *   - The hero renders the org name + a "Reservar" CTA that anchors to the
 *     sole service catalog (#servicios).
 *   - The booking flow itself is unchanged ("Elegí el servicio", id="bk-flow").
 *   - The landing surfaces the services vitrine + the "Hecho con Folio"
 *     powered-by footer.
 *   - On desktop the sticky mobile CTA is hidden; on mobile it points to
 *     the service catalog while the booking flow stays in #reservar.
 *
 * The real /book/[slug] route fetches the same data shape from Supabase;
 * this test isolates the UI integration without touching the DB.
 */

test.describe("/dev/book-preview · BookLanding + booking flow", () => {
  test("a service card carries its choice into the next Solo step and can be changed", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=solo");
    await page.locator(".bl-service-card").filter({ hasText: "Seguimiento" }).getByRole("link", { name: /elegir seguimiento/i }).click();
    await expect(page.locator("#bk-flow").getByRole("heading", { name: /elegí un horario/i })).toBeVisible();
    await expect(page.locator("#bk-flow .bk-current-service")).toContainText("Seguimiento");
    await page.locator("#bk-flow").getByRole("link", { name: /cambiar servicio/i }).click();
    await expect(page.locator("#bk-flow").getByRole("heading", { name: /elegí un servicio de la lista/i })).toBeVisible();
    await expect(page.locator(".bl-service-card")).toHaveCount(3);
    await expect(page.locator("#bk-flow .bk-servicio")).toHaveCount(0);
  });

  test("reselecting the active service keeps a loaded slot selectable", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=solo-slots");
    const currentCard = page.locator(".bl-service-card").filter({ hasText: "Seguimiento" });
    await currentCard.getByRole("link", { name: /elegir seguimiento/i }).click();
    await expect(page.locator("#bk-flow").getByRole("heading", { name: /elegí un horario/i })).toBeVisible();
    const slot = page.locator("#bk-flow .bk-slot").first();
    await expect(slot).toBeVisible();
    const slotLabel = await slot.getAttribute("aria-label");
    await currentCard.getByRole("link", { name: /elegir seguimiento/i }).click();
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute("aria-label", slotLabel!);
    await expect(page.locator("#bk-flow .bk-current-service")).toContainText("Seguimiento");
    await slot.click();
    await expect(page.locator("#bk-flow").getByRole("heading", { name: /tus datos/i })).toBeVisible();
  });

  test("a clinic service card goes straight to professional choice", async ({ page }) => {
    await page.goto("/dev/book-preview");
    await page.locator(".bl-service-card").filter({ hasText: "Consulta inicial" }).getByRole("link", { name: /elegir consulta inicial/i }).click();
    await expect(page.locator("#bk-flow").getByRole("heading", { name: /elegí profesional/i })).toBeVisible();
    await expect(page.locator("#bk-flow .bk-current-service")).toContainText("Consulta inicial");
  });

  test("draft preview shares the public layout without a working reservation", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=draft-preview");
    await expect(page.locator(".bl-root[data-mode='preview']")).toBeVisible();
    await expect(page.locator(".bl-preview-label")).toContainText("Vista previa");
    await expect(page.locator("#reservar")).toContainText("Los pacientes podrán elegir servicio y horario");
    await expect(page.locator("#bk-flow, .bl-service-cta, .bl-powered-cta")).toHaveCount(0);
  });

  test("a clinic without accepted professionals does not offer booking", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=clinic-empty");
    await expect(page.locator(".bl-hero")).toContainText("Turnos online en preparación");
    await expect(page.locator(".bl-book")).toContainText("todavía no tiene profesionales disponibles");
    await expect(page.locator(".bl-header-cta, .bl-btn-lg, .bl-service-cta, #bk-flow")).toHaveCount(0);
  });

  test("Solo prioritizes the professional and keeps the practice secondary", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=solo");
    await expect(page.locator(".bl-hero h1")).toHaveText("Lic. Lorenzo Martínez");
    await expect(page.locator(".bl-hero-practice")).toContainText("Consultorio Martínez");
    await expect(page.locator(".bl-portrait-image")).toHaveAttribute("alt", /Lorenzo Martínez/);
    await expect(page.locator(".bl-team")).toHaveCount(0);
    await expect(page.locator("#reservar #bk-flow")).toBeVisible();
  });

  test("an incomplete Solo profile falls back without an empty section", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=solo-empty");
    await expect(page.locator(".bl-hero h1")).toHaveText("Lic. Lorenzo Martínez");
    await expect(page.locator(".bl-portrait-initials")).toBeVisible();
    await expect(page.locator(".bl-portrait-image")).toHaveCount(0);
    await expect(page.locator(".bl-about")).toHaveCount(0);
  });

  test("an unnamed Solo profile does not attribute a portrait or license to the practice", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=solo-unnamed");
    await expect(page.locator(".bl-hero h1")).toHaveText("Consultorio Martínez");
    await expect(page.locator(".bl-portrait-image, .bl-hero-matricula, .bl-hero-practice")).toHaveCount(0);
    await expect(page.locator(".bl-hero-figure")).toBeVisible();
  });

  test("a clinic with one professional keeps the clinic identity and team", async ({ page }) => {
    await page.goto("/dev/book-preview?variant=clinic-one");
    await expect(page.locator(".bl-hero h1")).toHaveText("Atelier Kinesiología");
    await expect(page.locator(".bl-team-card")).toHaveCount(1);
  });

  test("hero renders the org name + a Reservar CTA above the flow", async ({ page }) => {
    await page.goto("/dev/book-preview");
    const hero = page.locator(".bl-hero");
    await expect(hero).toBeVisible();
    await expect(hero.locator(".bl-hero-title")).toContainText("Atelier Kinesiología");
    const cta = hero.locator("a.bl-btn-lg");
    await expect(cta).toContainText(/reservar/i);
    await expect(cta).toHaveAttribute("href", "#servicios");
  });

  test("booking flow renders inside #reservar with id='bk-flow'", async ({ page }) => {
    await page.goto("/dev/book-preview");
    await expect(page.locator("#reservar #bk-flow")).toBeVisible();
    await expect(
      page.locator("#bk-flow").getByRole("heading", { name: /elegí un servicio de la lista/i }),
    ).toBeVisible();
    await expect(page.locator("#bk-flow .bk-servicio")).toHaveCount(0);
  });

  test("landing surfaces the services vitrine + 'Hecho con Folio' footer", async ({ page }) => {
    await page.goto("/dev/book-preview");
    await expect(page.locator(".bl-services .bl-service-card").first()).toBeVisible();
    await expect(page.locator(".bl-powered")).toContainText(/hecho con\s*folio/i);
    await expect(page.locator(".bl-powered-cta")).toContainText(/creá la tuya/i);
  });

  test("equipo: el grid de profesionales muestra nombre + matrícula (M62)", async ({ page }) => {
    await page.goto("/dev/book-preview");
    const cards = page.locator(".bl-team .bl-team-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator(".bl-team-name")).toContainText("Lorenzo Martínez");
    await expect(cards.first().locator(".bl-team-matricula")).toContainText(/M\.P\./);
  });

  test("desktop: sticky mobile CTA is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dev/book-preview");
    const sticky = page.locator(".bl-sticky-cta");
    await expect(sticky).toBeAttached();
    await expect(sticky).not.toBeVisible();
  });

  test("mobile: sticky CTA points to the sole service catalog", async ({ page }) => {
    // The IntersectionObserver-driven `is-shown` toggle is verified manually at
    // the visual gate against a real /book/<slug> page — recreating that scroll
    // interaction reliably headless proved brittle across viewports, so we
    // assert the deterministic parts:
    //   - the sticky bar exists in the DOM on mobile
    //   - it carries the reserve CTA anchored to #servicios
    //   - the booking flow target (#reservar / #bk-flow) still resolves
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/dev/book-preview");
    const sticky = page.locator(".bl-sticky-cta");
    await expect(sticky).toBeAttached();
    const btn = sticky.locator(".bl-sticky-btn");
    await expect(btn).toContainText(/reservar/i);
    await expect(btn).toHaveAttribute("href", "#servicios");
    await expect(page.locator("#servicios")).toBeAttached();
    await expect(page.locator("#reservar")).toBeAttached();
    await expect(page.locator("#bk-flow")).toBeAttached();
  });

  test("Solo stays readable at narrow, desktop and enlarged layouts", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("folio.cookieConsent", "denied"); } catch { /* private browsing */ }
    });
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dev/book-preview?variant=solo");
      await expect(page.locator(".bl-hero h1")).toBeVisible();
      await page.locator(".bl-hero-text").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }

    const colors = await page.evaluate(() => {
      const selectors = [".bl-eyebrow", ".bl-hero-value", ".bl-hero-sub", ".bl-hero-matricula", ".bl-confirm-note", ".bl-section-kicker", ".bl-reservation-heading p", ".bl-service-dur", ".bl-service-cta", ".bl-book-footnote", ".bl-location-row", ".bl-powered-text"];
      const rgba = (value: string) => {
        const channels = [...value.matchAll(/[\d.]+/g)].map((match) => Number(match[0]));
        return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 };
      };
      return selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const foreground = rgba(getComputedStyle(element).color);
        let opacity = 1;
        const ancestors: HTMLElement[] = [];
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          ancestors.unshift(current);
          opacity *= Number(getComputedStyle(current).opacity);
        }
        const background = ancestors.reduce((base, ancestor) => {
          const layer = rgba(getComputedStyle(ancestor).backgroundColor);
          return base.map((channel, index) => layer.rgb[index] * layer.alpha + channel * (1 - layer.alpha));
        }, [255, 255, 255]);
        return { selector, foreground, background, opacity };
      });
    });
    const luminance = (channels: number[]) => {
      const [r, g, b] = channels.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    for (const { selector, foreground, background, opacity } of colors) {
      const effectiveOpacity = foreground.alpha * opacity;
      const fg = foreground.rgb.map((channel, index) => channel * effectiveOpacity + background[index] * (1 - effectiveOpacity));
      const light = Math.max(luminance(fg), luminance(background));
      const dark = Math.min(luminance(fg), luminance(background));
      const ratio = (light + 0.05) / (dark + 0.05);
      expect(ratio, `${selector}: ${foreground.rgb} on ${background} at opacity ${effectiveOpacity}`).toBeGreaterThanOrEqual(4.5);
    }

    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto("/dev/book-preview?variant=solo");
    await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
    await expect(page.locator(".bl-hero h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
  });
});

import { expect, test } from "../fixtures/local-test";

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin && ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort("blockedbyclient"));
  await context.addInitScript(() => localStorage.setItem("folio.cookieConsent", "denied"));
});

for(const width of [1440,768,390,320]) {
  test(`recorrido de producto: altura constante y una sola pantalla accesible a ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.goto("/#producto");
    await page.evaluate(()=>document.fonts.ready);
    const heights:number[]=[];
    for(const [label,heading] of [["La agenda","Tu agenda hoy"],["La historia clínica","Martina Ríos"],["Los cobros","Los números del día"]]) {
      await page.getByRole("tab",{name:label,exact:true}).click();
      const panel=page.getByRole("tabpanel",{name:label,exact:true});
      await expect(panel.getByRole("heading",{name:heading,exact:true})).toBeVisible();
      await expect(panel.getByRole("heading",{level:3})).toHaveCount(1);
      heights.push(await panel.evaluate(el=>el.getBoundingClientRect().height));
    }
    expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("indicador animado se detiene con movimiento reducido",async({page})=>{
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.goto("/#producto");
  const tabs=page.getByRole("tablist",{name:"Recorrer las funciones de Folio"});
  expect(await tabs.evaluate(el=>getComputedStyle(el,"::before").transitionProperty)).toBe("transform");
  await page.emulateMedia({reducedMotion:"reduce"});
  await expect.poll(()=>tabs.evaluate(el=>getComputedStyle(el,"::before").transitionDuration)).toBe("0s");
  await tabs.getByRole("tab",{name:"Los cobros"}).click();
  await expect(tabs.getByRole("tab",{name:"Los cobros"})).toHaveAttribute("aria-selected","true");
});

test("menú de tablet abre entre 768 y 800 px y se cierra al salir",async({page})=>{
  await page.setViewportSize({width:780,height:1000});
  await page.goto("/");
  const toggle=page.getByRole("button",{name:"Abrir menú de navegación"});
  await toggle.click();
  const panel=page.locator("#fl-mobile-nav");
  await expect(panel.getByRole("link",{name:"Producto",exact:true})).toBeVisible();
  const panelBox = await panel.boundingBox();
  await page.mouse.click(20, panelBox!.y + panelBox!.height + 30);
  await expect(panel).not.toBeVisible();
  await page.getByRole("button",{name:"Abrir menú de navegación"}).click();
  await page.setViewportSize({width:1000,height:1000});
  await page.setViewportSize({width:780,height:1000});
  await expect(page.getByRole("button",{name:"Abrir menú de navegación"})).toHaveAttribute("aria-expanded","false");
});

test("navegación móvil por teclado coloca el foco en el destino",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.getByRole("button",{name:"Abrir menú de navegación"}).press("Enter");
  const prices=page.locator("#fl-mobile-nav").getByRole("link",{name:"Precios",exact:true});
  await prices.focus();
  await prices.press("Enter");
  await expect(page.locator("#precios")).toBeFocused();
  await expect(page.locator("#fl-mobile-nav")).not.toBeVisible();
});

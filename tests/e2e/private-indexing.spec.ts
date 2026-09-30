import { expect, test } from "../fixtures/local-test";

const invitation = `/invitacion/${"a".repeat(43)}`;

test("access pages expose noindex while public onboarding stays in the sitemap", async ({ request }) => {
  for (const path of ["/login", "/reset-password", "/portal/login", invitation]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    const robots = html.match(/<meta\s+name="robots"\s+content="([^"]+)"\s*\/?\s*>/i)?.[1];
    expect(robots, path).toContain("noindex");
    expect(robots, path).toContain("nofollow");
  }

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  const origin = new URL(process.env.E2E_BASE_URL!).origin;
  expect(xml).not.toContain(`<loc>${origin}/login</loc>`);
  expect(xml).toContain(`<loc>${origin}/onboarding</loc>`);
});

test("anonymous staff and patient routes still redirect to their login pages", async ({ request }) => {
  for (const [privatePath, loginPath] of [["/hoy", "/login"], ["/portal", "/portal/login"]]) {
    const response = await request.get(privatePath);
    expect(new URL(response.url()).pathname, privatePath).toBe(loginPath);
  }
});

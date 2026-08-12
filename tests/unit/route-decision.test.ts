/**
 * Folio · matriz de ruteo del middleware.
 *
 * Antes esta lógica vivía enredada con el I/O del middleware y no había forma
 * de testearla sin levantar un runtime — que es justamente donde vivía el bug
 * del loop de login. Estos tests fijan CADA rama, incluidas las sutiles que un
 * refactor rompe sin que nadie lo note hasta que un usuario queda encerrado.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  decideRouteGate,
  entryDestination,
  isPortalPath,
  isPublicPath,
  portalDestination,
  portalLoginDestination,
  PUBLIC_PATHS,
  PUBLIC_PREFIXES,
} from "../../lib/auth/route-decision";

// ─── Rutas públicas ─────────────────────────────────────────────────────────

test("todas las PUBLIC_PATHS son públicas", () => {
  for (const p of PUBLIC_PATHS) {
    assert.equal(isPublicPath(p), true, `${p} debería ser pública`);
  }
});

test("los PUBLIC_PREFIXES cubren sus subrutas", () => {
  for (const p of PUBLIC_PREFIXES) {
    assert.equal(isPublicPath(`${p}algo`), true, `${p}algo debería ser pública`);
  }
});

test("una ruta de la app no es pública", () => {
  for (const p of ["/hoy", "/pacientes", "/pacientes/abc", "/configuracion", "/finanzas", "/agenda"]) {
    assert.equal(isPublicPath(p), false, `${p} NO debería ser pública`);
  }
});

test("el prefijo no matchea por coincidencia textual parcial", () => {
  // "/book/" es público; "/booking-interno" no puede colarse.
  assert.equal(isPublicPath("/booking-interno"), false);
  assert.equal(isPublicPath("/profesionales-privado"), false);
  // Pero "/profesionales" exacto sí (está en PUBLIC_PATHS).
  assert.equal(isPublicPath("/profesionales"), true);
});

test("isPortalPath: /portal exacto y sus subrutas, nada más", () => {
  assert.equal(isPortalPath("/portal"), true);
  assert.equal(isPortalPath("/portal/"), true);
  assert.equal(isPortalPath("/portal/turnos"), true);
  assert.equal(isPortalPath("/portalero"), false);
  assert.equal(isPortalPath("/hoy"), false);
});

// ─── Sin sesión ─────────────────────────────────────────────────────────────

test("sin sesión, una ruta de la app manda a /login conservando a dónde iba", () => {
  const g = decideRouteGate("/pacientes/abc", false);
  assert.deepEqual(g, { kind: "redirect", to: "/login", keepRedirectParam: true });
});

test("sin sesión, /portal/* va al login DEL PORTAL, no al de staff", () => {
  // Son dos públicos distintos: el de staff pide password, el del portal es
  // magic-link. Mandar a un paciente al login de staff es un dead-end.
  for (const p of ["/portal", "/portal/turnos", "/portal/mis-datos"]) {
    assert.deepEqual(
      decideRouteGate(p, false),
      { kind: "redirect", to: "/portal/login", keepRedirectParam: false },
      p,
    );
  }
});

test("sin sesión, /api/portal/* responde 401 JSON y no el HTML del login", () => {
  // Bajar "Mis datos" con la sesión vencida devolvía el HTML del login de
  // staff, que el cliente no puede parsear.
  assert.deepEqual(decideRouteGate("/api/portal/export", false), { kind: "json_401" });
});

test("sin sesión, las rutas públicas pasan", () => {
  for (const p of ["/", "/login", "/onboarding", "/book/dr-lopez", "/portal/login", "/api/health"]) {
    assert.deepEqual(decideRouteGate(p, false), { kind: "pass" }, p);
  }
});

// ─── Con sesión ─────────────────────────────────────────────────────────────

test("con sesión, / y /login necesitan resolver la audiencia", () => {
  assert.deepEqual(decideRouteGate("/", true), { kind: "needs_audience", scope: "entry" });
  assert.deepEqual(decideRouteGate("/login", true), { kind: "needs_audience", scope: "entry" });
});

test("con sesión, /portal/login y /portal/* tienen scopes distintos", () => {
  assert.deepEqual(
    decideRouteGate("/portal/login", true),
    { kind: "needs_audience", scope: "portal_login" },
  );
  assert.deepEqual(
    decideRouteGate("/portal/turnos", true),
    { kind: "needs_audience", scope: "portal" },
  );
});

test("con sesión, el resto de la app pasa sin costo de queries", () => {
  // Esto es lo que evita pagar 2 queries por navegación: solo las rutas de
  // entrada ambiguas resuelven audiencia.
  for (const p of ["/hoy", "/pacientes", "/agenda", "/configuracion/billing", "/finanzas"]) {
    assert.deepEqual(decideRouteGate(p, true), { kind: "pass" }, p);
  }
});

// ─── Destinos ───────────────────────────────────────────────────────────────

test("en las rutas de entrada, STAFF le gana a paciente", () => {
  // Un profesional que además es paciente en otro consultorio entra a /hoy.
  assert.equal(entryDestination({ isMember: true, isPortalAccount: true }), "/hoy");
  assert.equal(entryDestination({ isMember: true, isPortalAccount: false }), "/hoy");
  // Sólo paciente → portal.
  assert.equal(entryDestination({ isMember: false, isPortalAccount: true }), "/portal");
  // Ninguno (sesión sin org todavía: recién salido del signup) → /hoy, que es
  // quien decide mandarlo a /onboarding.
  assert.equal(entryDestination({ isMember: false, isPortalAccount: false }), "/hoy");
});

test("una sesión de STAFF en /portal/login NO se redirige", () => {
  // Rama sutil: puede querer entrar a un buzón de paciente distinto. Si esto
  // se rompe, el staff queda rebotando fuera del login del portal.
  assert.equal(portalLoginDestination({ isMember: true, isPortalAccount: false }), null);
  assert.equal(portalLoginDestination({ isMember: false, isPortalAccount: false }), null);
  // Con cuenta de portal sí entra derecho.
  assert.equal(portalLoginDestination({ isMember: false, isPortalAccount: true }), "/portal");
  assert.equal(portalLoginDestination({ isMember: true, isPortalAccount: true }), "/portal");
});

test("en /portal/*, quien no tiene cuenta de portal sale por donde corresponde", () => {
  assert.equal(portalDestination({ isMember: false, isPortalAccount: true }), null);
  assert.equal(portalDestination({ isMember: true, isPortalAccount: true }), null);
  // Profesional sin ficha de paciente: no tiene nada que hacer en el portal.
  assert.equal(portalDestination({ isMember: true, isPortalAccount: false }), "/hoy");
  // Ninguno: defensa, no debería pasar con sesión válida de portal.
  assert.equal(portalDestination({ isMember: false, isPortalAccount: false }), "/portal/login");
});

// ─── El loop reportado ──────────────────────────────────────────────────────

test("el camino del loop: con sesión, / y /login SIEMPRE redirigen", () => {
  // Este es el punto: las dos rutas más transitadas después de entrar producen
  // un redirect. Si esa response no se lleva las cookies refrescadas, el
  // refresh token rotado se pierde y la sesión muere. La preservación se testea
  // en response-cookie-copy.test.ts; acá queda fijado que el redirect ocurre,
  // que es lo que hace que el bug fuera sistemático y no ocasional.
  for (const p of ["/", "/login"]) {
    const g = decideRouteGate(p, true);
    assert.equal(g.kind, "needs_audience");
  }
  // Y con cualquier audiencia, la decisión es un destino (nunca "quedate acá").
  for (const aud of [
    { isMember: true, isPortalAccount: false },
    { isMember: false, isPortalAccount: true },
    { isMember: true, isPortalAccount: true },
    { isMember: false, isPortalAccount: false },
  ]) {
    assert.ok(entryDestination(aud).startsWith("/"));
  }
});

/**
 * Folio · las cookies de sesión sobreviven a los redirects del middleware.
 *
 * El refresh token de Supabase ROTA: cada uso invalida el anterior. Si el
 * middleware refresca la sesión y devuelve un redirect que no lleva las cookies
 * nuevas, el browser se queda con el token viejo y la request siguiente muere
 * con "Invalid Refresh Token: Already Used" → sesión caída → landing. Con
 * sesión, `/` y `/login` SIEMPRE redirigen, así que ese era el camino más
 * transitado de la app.
 *
 * Copiar sólo name/value no alcanza: el browser trata una cookie con distinto
 * `path`, `domain` o `sameSite` como OTRA cookie. Quedarían dos entradas
 * peleando y la sesión seguiría rota, pero de una forma mucho más difícil de
 * diagnosticar. Por eso estos tests miran los atributos uno por uno.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import { redirectWithCookies, withResponseCookies } from "../../lib/supabase/middleware";

/** Las dos cookies que emite @supabase/ssr al refrescar, con atributos reales. */
function responseConSesionRefrescada(): NextResponse {
  const res = NextResponse.next();
  res.cookies.set("sb-grkpayhxndztlfwxobnt-auth-token.0", "base64-parte-1", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60,
  });
  res.cookies.set("sb-grkpayhxndztlfwxobnt-auth-token.1", "base64-parte-2", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60,
  });
  return res;
}

test("withResponseCookies copia todas las cookies, no sólo la primera", () => {
  // Supabase parte el token en varios chunks cuando no entra en una cookie:
  // copiar sólo una deja la sesión ilegible.
  const destino = withResponseCookies(responseConSesionRefrescada(), NextResponse.next());
  assert.equal(destino.cookies.getAll().length, 2);
});

test("withResponseCookies preserva TODOS los atributos", () => {
  const destino = withResponseCookies(responseConSesionRefrescada(), NextResponse.next());
  const c = destino.cookies.get("sb-grkpayhxndztlfwxobnt-auth-token.0");

  assert.ok(c, "la cookie tiene que existir en el destino");
  assert.equal(c.value, "base64-parte-1");
  assert.equal(c.path, "/", "sin path, el browser la guarda como otra cookie");
  assert.equal(c.httpOnly, true, "sin httpOnly, el token queda expuesto a JS");
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, "lax", "sin sameSite, el retorno del OAuth no la manda");
  assert.equal(c.maxAge, 3600);
});

test("redirectWithCookies: el redirect se lleva la sesión refrescada", () => {
  // El caso exacto del loop: con sesión, `/` redirige a /hoy.
  const res = redirectWithCookies(responseConSesionRefrescada(), "https://folio.app/hoy");

  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "https://folio.app/hoy");
  assert.equal(res.cookies.getAll().length, 2);
  assert.equal(
    res.cookies.get("sb-grkpayhxndztlfwxobnt-auth-token.1")?.value,
    "base64-parte-2",
  );
});

test("una response sin cookies no rompe la copia", () => {
  // Camino normal: la sesión no necesitaba refresh, así que no hay nada que
  // copiar. No puede tirar ni inventar cookies.
  const destino = withResponseCookies(NextResponse.next(), NextResponse.next());
  assert.equal(destino.cookies.getAll().length, 0);
});

test("copiar no pisa una cookie que el destino ya traía con otro nombre", () => {
  const destino = NextResponse.next();
  destino.cookies.set("folio.otra", "intacta", { path: "/" });
  withResponseCookies(responseConSesionRefrescada(), destino);

  assert.equal(destino.cookies.get("folio.otra")?.value, "intacta");
  assert.equal(destino.cookies.getAll().length, 3);
});

test("una cookie de borrado (maxAge 0) se copia como borrado", () => {
  // signOut emite las cookies de sesión con maxAge 0. Si la copia perdiera ese
  // atributo, cerrar sesión dejaría la sesión viva.
  const origen = NextResponse.next();
  origen.cookies.set("sb-x-auth-token", "", { path: "/", maxAge: 0 });
  const destino = withResponseCookies(origen, NextResponse.next());

  assert.equal(destino.cookies.get("sb-x-auth-token")?.maxAge, 0);
});

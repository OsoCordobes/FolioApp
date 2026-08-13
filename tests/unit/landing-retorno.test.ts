/**
 * Folio · retornos de OAuth que aterrizan en la landing.
 *
 * El bug real: GoTrue descartó el `redirect_to` (no estaba en la allow-list),
 * mandó al Site URL —la landing— y la página renderizó el marketing como si
 * nada. El login con Google estuvo roto días sin que nadie se enterara.
 *
 * Lo que se protege acá es que ese aterrizaje se DETECTE, y que la visita
 * normal a la landing —que es el 99.9%— no muestre absolutamente nada.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { detectarRetornoAuth, urlSinParamsDeAuth } from "../../lib/auth/landing-retorno";

// ─── Lo normal: no molestar ─────────────────────────────────────────────────

test("una visita común a la landing no dispara nada", () => {
  assert.equal(detectarRetornoAuth("", ""), null);
  assert.equal(detectarRetornoAuth("?", "#"), null);
});

test("los params de marketing no se confunden con un retorno de auth", () => {
  // utm_*, gclid y anclas de navegación son lo que de verdad trae la landing.
  assert.equal(
    detectarRetornoAuth("?utm_source=instagram&utm_campaign=lanzamiento&gclid=abc", "#precios"),
    null,
  );
});

// ─── El caso que rompió producción ──────────────────────────────────────────

test("un ?code= en la landing es un login que se perdió en el último salto", () => {
  // La landing no puede canjearlo: el exchange vive en /api/auth/callback.
  // Que el code haya llegado ACÁ significa que GoTrue no entregó al callback.
  const r = detectarRetornoAuth("?code=8f3a1b2c-dead-beef", "");
  assert.deepEqual(r, { kind: "code_perdido" });
});

test("un access_token en el hash también es un retorno perdido", () => {
  // El implicit flow devuelve el token por el hash, que el server nunca ve.
  const r = detectarRetornoAuth("", "#access_token=ey.J&expires_in=3600&token_type=bearer");
  assert.deepEqual(r, { kind: "code_perdido" });
});

// ─── Errores explícitos de GoTrue ───────────────────────────────────────────

test("un error en la query se mapea al catálogo", () => {
  const r = detectarRetornoAuth("?error=access_denied&error_code=otp_expired", "");
  assert.deepEqual(r, { kind: "error", codigo: "code_expired" });
});

test("un error en el HASH también se detecta", () => {
  // GoTrue manda los errores del implicit flow por el hash. Mirar sólo la
  // query perdía la mitad de los casos — y son justo los que no dejan rastro
  // en ningún log del server.
  const r = detectarRetornoAuth("", "#error=access_denied&error_code=otp_expired");
  assert.deepEqual(r, { kind: "error", codigo: "code_expired" });
});

test("un código desconocido no se filtra crudo: cae al genérico", () => {
  const r = detectarRetornoAuth("?error=algo_que_nadie_vio_nunca", "");
  assert.equal(r?.kind, "error");
  assert.equal(r?.kind === "error" && r.codigo, "oauth_failed");
});

test("si hay error Y code, manda el error", () => {
  // Decir "se perdió tu ingreso" cuando GoTrue ya explicó qué pasó sería
  // cambiar un diagnóstico concreto por uno vago.
  const r = detectarRetornoAuth("?code=abc&error=access_denied&error_code=otp_expired", "");
  assert.deepEqual(r, { kind: "error", codigo: "code_expired" });
});

// ─── Limpieza de la URL ─────────────────────────────────────────────────────

test("la URL queda sin el material de auth", () => {
  const limpia = urlSinParamsDeAuth(
    "https://foliosalud.com/?code=secreto&state=xyz&utm_source=ig#access_token=ey.J",
  );
  assert.equal(limpia, "https://foliosalud.com/?utm_source=ig");
  assert.ok(!limpia.includes("secreto"), "el code no puede quedar en el historial");
  assert.ok(!limpia.includes("access_token"));
});

test("sin parámetros de auth la URL no cambia de forma", () => {
  assert.equal(urlSinParamsDeAuth("https://foliosalud.com/"), "https://foliosalud.com/");
});

test("no queda un '?' colgando cuando se van todos los params", () => {
  assert.equal(
    urlSinParamsDeAuth("https://foliosalud.com/?code=abc&state=xyz"),
    "https://foliosalud.com/",
  );
});

test("limpiar dos veces da lo mismo", () => {
  // El efecto puede correr de nuevo (StrictMode en dev remonta): la segunda
  // pasada no tiene que romper la URL.
  const una = urlSinParamsDeAuth("https://foliosalud.com/?code=abc&utm_source=ig");
  assert.equal(urlSinParamsDeAuth(una), una);
});

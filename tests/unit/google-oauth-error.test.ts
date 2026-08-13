/**
 * Folio · mensajes de error del OAuth de Google (E1).
 *
 * Lo que se protege acá es una sola regla: el código crudo NUNCA llega a la
 * pantalla. `invalid_state` o `encrypt_failed` no le dicen nada al profesional
 * que quería conectar su agenda — y era peor antes, cuando no se mostraba
 * absolutamente nada y el intento fallido era indistinguible de no haber
 * hecho clic.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { mensajeErrorOauthGoogle } from "../../lib/google/oauth-error";

const CODIGOS_DEL_CALLBACK = [
  "missing_params",
  "invalid_state",
  "no_tokens",
  "encrypt_failed",
  "oauth_failed",
] as const;

test("sin código no hay mensaje: la pantalla queda como siempre", () => {
  assert.equal(mensajeErrorOauthGoogle(null), null);
  assert.equal(mensajeErrorOauthGoogle(undefined), null);
  assert.equal(mensajeErrorOauthGoogle(""), null);
});

test("los cinco códigos que emite el callback tienen mensaje propio", () => {
  // Si alguien agrega un failRedirect nuevo en app/api/google/callback y no lo
  // mapea acá, cae en el genérico — aceptable, pero estos cinco existen hoy y
  // merecen decir qué hacer.
  const vistos = new Set<string>();
  for (const code of CODIGOS_DEL_CALLBACK) {
    const msg = mensajeErrorOauthGoogle(code);
    assert.ok(msg, `${code} sin mensaje`);
    assert.ok(!vistos.has(msg), `${code} repite el mensaje de otro código`);
    vistos.add(msg);
  }
});

test("access_denied dice que lo canceló el usuario, no que falló Folio", () => {
  // Es el caso más común y no es un error: alguien apretó "Cancelar" en la
  // pantalla de Google. Tratarlo como una falla del sistema haría que
  // desconfíe de la app por algo que decidió él.
  const msg = mensajeErrorOauthGoogle("access_denied");
  assert.match(msg!, /cancelaste/i);
});

test("un código desconocido no se filtra crudo a la pantalla", () => {
  // Google puede sumar códigos nuevos cuando quiera, y el usuario nunca tiene
  // que leer `org_internal` ni `disallowed_useragent`.
  for (const code of ["org_internal", "disallowed_useragent", "☠", "1=1"]) {
    const msg = mensajeErrorOauthGoogle(code);
    assert.ok(msg, `${code} sin mensaje`);
    assert.ok(!msg.includes(code), `el código crudo "${code}" se filtró al mensaje`);
  }
});

test("ningún mensaje deja al usuario sin próximo paso", () => {
  const todos = [...CODIGOS_DEL_CALLBACK, "access_denied", "admin_policy_enforced", "loquesea"];
  for (const code of todos) {
    const msg = mensajeErrorOauthGoogle(code)!;
    assert.ok(
      /probá|pedile|empezá|escribinos|aceptá/i.test(msg),
      `"${code}" describe el problema pero no dice qué hacer: ${msg}`,
    );
  }
});

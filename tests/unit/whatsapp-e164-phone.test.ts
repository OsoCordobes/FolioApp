/**
 * Folio · unit tests para toWhatsappE164 / waMeLink (lib/format/phone).
 *
 * Cubre formatos AR reales: móvil con/sin "15", fijo, ya-con-54, +54 9, y
 * códigos de área de 2/3/4 dígitos. La normalización debe ser idempotente
 * (re-normalizar un E.164 ya armado no lo cambia).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { toWhatsappE164, waMeLink } from "../../lib/format/phone";

test("móvil con '15' (formato nacional) → 549 + NSN, sin 0/15", () => {
  // Córdoba, área de 3 dígitos.
  assert.equal(toWhatsappE164("0351 15-555-1234"), "5493515551234");
  assert.equal(toWhatsappE164("0351 15 555 1234"), "5493515551234");
  // Sin troncal 0 pero con 15.
  assert.equal(toWhatsappE164("351 15 555 1234"), "5493515551234");
  // CABA, área de 2 dígitos, con troncal + 15.
  assert.equal(toWhatsappE164("011 15 4321 5678"), "5491143215678");
  assert.equal(toWhatsappE164("11 15 4321 5678"), "5491143215678");
});

test("móvil sin '15' (local pelado) → se asume móvil (549 + NSN)", () => {
  assert.equal(toWhatsappE164("351 411-2233"), "5493514112233");
  assert.equal(toWhatsappE164("3515551234"), "5493515551234");
  // CABA pelado.
  assert.equal(toWhatsappE164("11 4321 5678"), "5491143215678");
  // "9" móvil sin país (formato suelto).
  assert.equal(toWhatsappE164("9 351 555 1234"), "5493515551234");
});

test("fijo (troncal/país sin marcador móvil) → 54 + NSN, sin 9", () => {
  // Troncal 0, sin 15 → fijo.
  assert.equal(toWhatsappE164("0351 412-3456"), "543514123456");
  assert.equal(toWhatsappE164("011 4123-4567"), "541141234567");
  // Ya con país, sin 9 → fijo.
  assert.equal(toWhatsappE164("+54 11 4123 4567"), "541141234567");
  assert.equal(toWhatsappE164("54 351 412 3456"), "543514123456");
});

test("ya-con-54 / +54 9 → idempotente", () => {
  // Móvil E.164 ya armado.
  assert.equal(toWhatsappE164("5493515551234"), "5493515551234");
  assert.equal(toWhatsappE164("+54 9 351 555 1234"), "5493515551234");
  assert.equal(toWhatsappE164("+5493515551234"), "5493515551234");
  // Fijo E.164 ya armado.
  assert.equal(toWhatsappE164("543514123456"), "543514123456");
  // Prefijo de acceso internacional 00.
  assert.equal(toWhatsappE164("005493515551234"), "5493515551234");
});

test("idempotencia: normalizar dos veces da el mismo resultado", () => {
  for (const raw of [
    "0351 15-555-1234",
    "351 411-2233",
    "+54 9 11 4321 5678",
    "011 4123-4567",
    "54 351 412 3456",
  ]) {
    const once = toWhatsappE164(raw);
    assert.ok(once, `esperaba normalizar ${raw}`);
    assert.equal(toWhatsappE164(once), once, `idempotencia falló para ${raw}`);
  }
});

test("área de 2/3/4 dígitos: el NSN de 10 dígitos se preserva", () => {
  // 2 dígitos (CABA): 11 + 8.
  assert.equal(toWhatsappE164("+54 9 11 4321 5678"), "5491143215678");
  // 3 dígitos (Córdoba): 351 + 7.
  assert.equal(toWhatsappE164("+54 9 351 555 1234"), "5493515551234");
  // 4 dígitos (localidad chica): 2954 + 6, con 15.
  assert.equal(toWhatsappE164("02954 15 123456"), "5492954123456");
  assert.equal(toWhatsappE164("2954 123456"), "5492954123456");
  // 4 dígitos ya en E.164 móvil → idempotente.
  assert.equal(toWhatsappE164("5492954123456"), "5492954123456");
});

test("inputs inválidos → null", () => {
  assert.equal(toWhatsappE164(""), null);
  assert.equal(toWhatsappE164(null), null);
  assert.equal(toWhatsappE164(undefined), null);
  assert.equal(toWhatsappE164("abc"), null);
  assert.equal(toWhatsappE164("()"), null);
  assert.equal(toWhatsappE164("123"), null, "muy corto para un NSN AR");
  assert.equal(toWhatsappE164("12345678"), null, "8 dígitos sin área → no normalizable");
});

test("waMeLink arma el deep-link o null", () => {
  assert.equal(waMeLink("351 411-2233"), "https://wa.me/5493514112233");
  assert.equal(
    waMeLink("351 411-2233", "Hola!"),
    "https://wa.me/5493514112233?text=Hola!",
  );
  assert.equal(waMeLink(""), null);
  assert.equal(waMeLink(null), null);
});

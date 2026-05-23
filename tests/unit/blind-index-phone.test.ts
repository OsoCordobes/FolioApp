/**
 * Folio · unit tests para blindIndexPhone (M30 dedup helper).
 *
 * Carga .env.local antes de importar lib/crypto para que FOLIO_ENC_HMAC_KEY
 * esté disponible (mismo pattern que crypto-roundtrip.test.ts).
 */

import { readFileSync } from "node:fs";

if (!process.env.FOLIO_ENC_HMAC_KEY) {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?([^"\r\n]+)"?$/.exec(line.trim());
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // .env.local missing — los tests con env-vars fallarán ruidosamente.
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import { blindIndexPhone } from "../../lib/crypto";

test("blindIndexPhone normaliza formatos comunes al mismo hash", () => {
  const a = blindIndexPhone("+54 9 351 555 1234");
  const b = blindIndexPhone("3515551234");
  const c = blindIndexPhone("(351) 555-1234");
  const d = blindIndexPhone("0351 5551234");
  const e = blindIndexPhone("+5493515551234");
  assert.equal(a, b, "espacios y prefijo internacional deben colapsar");
  assert.equal(b, c, "paréntesis y guiones se descartan");
  assert.equal(c, d, "código de área con cero leading queda igual a sin");
  assert.equal(d, e, "código país +54 9 (móvil) sigue colapsando a últimos 10 dígitos");
  assert.ok(a && /^[0-9a-f]{64}$/.test(a), "output es hex SHA-256 (64 chars)");
});

test("blindIndexPhone devuelve null para inputs no-válidos", () => {
  assert.equal(blindIndexPhone(""), null, "string vacío");
  assert.equal(blindIndexPhone(null), null, "null");
  assert.equal(blindIndexPhone(undefined), null, "undefined");
  assert.equal(blindIndexPhone("123"), null, "menos de 8 dígitos");
  assert.equal(blindIndexPhone("abc"), null, "sin dígitos");
  assert.equal(blindIndexPhone("()"), null, "solo símbolos");
  assert.equal(blindIndexPhone("1234567"), null, "7 dígitos no alcanza");
});

test("blindIndexPhone produce hashes distintos para números distintos", () => {
  const a = blindIndexPhone("+54 11 4321 5678");
  const b = blindIndexPhone("+54 11 4321 5679");
  const c = blindIndexPhone("+54 351 555 1234");
  assert.notEqual(a, b, "último dígito distinto → hash distinto");
  assert.notEqual(b, c, "ciudad distinta → hash distinto");
});

test("blindIndexPhone solo considera los últimos 10 dígitos", () => {
  // Los dígitos extra al inicio (código país, prefijos) NO deben afectar.
  const a = blindIndexPhone("+54 9 11 4321 5678");                  // 12 dígitos
  const b = blindIndexPhone("11 4321 5678");                        // 10 dígitos
  const c = blindIndexPhone("11 4321 5678 extension 99 not phone"); // junk al final
  assert.equal(a, b, "12 dígitos vs 10 → mismos últimos 10 colapsan");
  assert.notEqual(b, c, "junk al final se mete en los últimos 10 → distinto (esperado)");
});

test("blindIndexPhone es estable entre llamadas (determinístico)", () => {
  const phone = "+54 351 555 1234";
  const first = blindIndexPhone(phone);
  const second = blindIndexPhone(phone);
  const third = blindIndexPhone(phone);
  assert.equal(first, second);
  assert.equal(second, third);
});

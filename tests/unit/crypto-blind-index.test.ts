/**
 * Folio · unit tests para blindIndex/blindIndexPhone con per-tenant salt
 * (audit finding A2 · Sprint 1 T1.5.1).
 *
 * Carga .env.local antes de importar lib/crypto para que FOLIO_ENC_HMAC_KEY
 * esté disponible (mismo pattern que blind-index-phone.test.ts).
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

import { blindIndex, blindIndexPhone } from "../../lib/crypto";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

// ─── blindIndex con salt opcional ────────────────────────────────────

test("blindIndex sin salt: idempotente para misma entrada", () => {
  const a = blindIndex("Carlos Vega");
  const b = blindIndex("Carlos Vega");
  assert.equal(a, b);
  assert.ok(a && /^[0-9a-f]{64}$/.test(a));
});

test("blindIndex sin salt: normalización trim+lowercase", () => {
  const a = blindIndex("Carlos Vega");
  const b = blindIndex("  carlos vega  ");
  const c = blindIndex("CARLOS VEGA");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("blindIndex con salt: mismo plaintext + diferente org = diferente hash", () => {
  const a = blindIndex("Carlos Vega", ORG_A);
  const b = blindIndex("Carlos Vega", ORG_B);
  assert.ok(a && b);
  assert.notEqual(a, b, "el salt per-tenant debe divergir los hashes");
});

test("blindIndex con salt: idempotente intra-org", () => {
  const a = blindIndex("Carlos Vega", ORG_A);
  const b = blindIndex("Carlos Vega", ORG_A);
  assert.equal(a, b);
});

test("blindIndex con salt: backward-incompatible con versión sin salt (esperado durante migración)", () => {
  const withSalt = blindIndex("Carlos Vega", ORG_A);
  const without = blindIndex("Carlos Vega");
  assert.notEqual(withSalt, without, "el salt cambia el hash; los call sites deben migrarse coordinadamente");
});

test("blindIndex con salt: input normalizado igual (trim+lower)", () => {
  const a = blindIndex("Carlos Vega", ORG_A);
  const b = blindIndex("  CARLOS VEGA  ", ORG_A);
  assert.equal(a, b);
});

test("blindIndex con salt vacío: equivalente a sin salt (defensa contra '' accidental)", () => {
  // Por diseño actual: salt="" es falsy, por lo tanto se ignora.
  const withEmptySalt = blindIndex("Carlos Vega", "");
  const without = blindIndex("Carlos Vega");
  assert.equal(withEmptySalt, without);
});

test("blindIndex con plain null/undefined: retorna null independiente del salt", () => {
  assert.equal(blindIndex(null), null);
  assert.equal(blindIndex(undefined), null);
  assert.equal(blindIndex(null, ORG_A), null);
  assert.equal(blindIndex(undefined, ORG_A), null);
});

test("blindIndex con plain solo whitespace: retorna null independiente del salt", () => {
  assert.equal(blindIndex("   ", ORG_A), null);
  assert.equal(blindIndex("\t\n", ORG_A), null);
});

// ─── blindIndexPhone con salt opcional ───────────────────────────────

test("blindIndexPhone con salt: mismo número + diferente org = diferente hash", () => {
  const a = blindIndexPhone("+54 9 351 555 1234", ORG_A);
  const b = blindIndexPhone("+54 9 351 555 1234", ORG_B);
  assert.ok(a && b);
  assert.notEqual(a, b);
});

test("blindIndexPhone con salt: normalización (formatos variantes mismo hash dentro de org)", () => {
  const a = blindIndexPhone("+54 9 351 555 1234", ORG_A);
  const b = blindIndexPhone("(351) 555-1234", ORG_A);
  const c = blindIndexPhone("3515551234", ORG_A);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("blindIndexPhone con salt: backward-incompatible con sin salt (esperado durante migración)", () => {
  const withSalt = blindIndexPhone("3515551234", ORG_A);
  const without = blindIndexPhone("3515551234");
  assert.notEqual(withSalt, without);
});

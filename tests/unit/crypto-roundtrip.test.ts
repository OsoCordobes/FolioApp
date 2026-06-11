/**
 * Load .env.local synchronously BEFORE importing lib/crypto so the AES keys
 * are present when the module's lazy getters fire (the helpers are
 * lazy-evaluated, but a defensive load up-front avoids any test that hits
 * them at import time from failing).
 */
import { readFileSync } from "node:fs";

if (!process.env.FOLIO_ENC_KEY || !process.env.FOLIO_ENC_HMAC_KEY) {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?([^"\r\n]+)"?$/.exec(line.trim());
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // .env.local missing — tests will fail loudly when keys are needed.
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  encryptColumn,
  decryptColumn,
  blindIndex,
  encryptFields,
  generateKeyBase64,
  tryDecrypt,
} from "../../lib/crypto";

test("encryptColumn → decryptColumn round-trip preserves content", () => {
  const samples = [
    "Lorenzo Martínez",
    "amiunelautaro@gmail.com",
    "+54 9 351 411 2233",
    "Av. Colón 1234, Nueva Córdoba",
    "💊 sesión 3 SOAP — paciente con dolor cervical agudo",
    "X".repeat(2000),
    "single",
    " trimmed with spaces ",
  ];
  for (const s of samples) {
    const cipher = encryptColumn(s);
    assert.ok(typeof cipher === "string" && cipher.startsWith("\\x"), `cipher must be \\x<hex> for ${JSON.stringify(s)}`);
    const plain = decryptColumn(cipher);
    assert.equal(plain, s, `round-trip must preserve content for ${JSON.stringify(s)}`);
  }
});

test("encryptColumn produces different ciphertext for same plaintext (IV randomness)", () => {
  const a = encryptColumn("Lorenzo Martínez");
  const b = encryptColumn("Lorenzo Martínez");
  assert.notEqual(a, b, "two calls must produce different ciphertext (random IV)");
  assert.equal(decryptColumn(a), "Lorenzo Martínez");
  assert.equal(decryptColumn(b), "Lorenzo Martínez");
});

test("encryptColumn / decryptColumn pass through null + undefined", () => {
  assert.equal(encryptColumn(null), null);
  assert.equal(encryptColumn(undefined), null);
  assert.equal(decryptColumn(null), null);
  assert.equal(decryptColumn(undefined), null);
  assert.equal(decryptColumn(""), null);
});

test("decryptColumn accepts multiple wire formats", () => {
  const cipher = encryptColumn("test value")!;
  assert.equal(decryptColumn(cipher), "test value");
  const hex = cipher.slice(2);
  assert.equal(decryptColumn(hex), "test value");
  const buf = Buffer.from(hex, "hex");
  assert.equal(decryptColumn(buf), "test value");
  assert.equal(decryptColumn(new Uint8Array(buf)), "test value");
});

test("decryptColumn rejects short / corrupt ciphertext", () => {
  assert.throws(() => decryptColumn("\\x00112233"), /ciphertext demasiado corto/);
});

test("tryDecrypt: ciphertext válido → plaintext (mismo resultado que decryptColumn)", () => {
  const cipher = encryptColumn("Lorenzo Martínez")!;
  assert.equal(tryDecrypt(cipher, "test.nombre"), "Lorenzo Martínez");
});

test("tryDecrypt: ciphertext corrupto → null SIN throw (una fila corrupta no tumba el listado)", () => {
  assert.equal(tryDecrypt("\\x00112233", "test.corrupto"), null);
  // GCM auth tag inválido (ciphertext largo pero adulterado)
  const cipher = encryptColumn("dato sano")!;
  const tampered = cipher.slice(0, -8) + "00000000";
  assert.equal(tryDecrypt(tampered, "test.adulterado"), null);
});

test("tryDecrypt: null/undefined/vacío pasan a null como decryptColumn", () => {
  assert.equal(tryDecrypt(null, "test.null"), null);
  assert.equal(tryDecrypt(undefined, "test.undefined"), null);
  assert.equal(tryDecrypt("", "test.vacio"), null);
});

test("blindIndex is deterministic for the same input (case + space normalized)", () => {
  const a = blindIndex("Lorenzo Martínez");
  const b = blindIndex("  lorenzo martínez  ");
  const c = blindIndex("LORENZO MARTÍNEZ");
  assert.equal(a, b, "trim + lowercase normalization");
  assert.equal(a, c, "case-insensitive");
});

test("blindIndex produces SHA-256 hex (64 chars)", () => {
  const h = blindIndex("any-dni-12345678");
  assert.ok(typeof h === "string" && /^[0-9a-f]{64}$/.test(h!), "must be 64-char lowercase hex");
});

test("blindIndex returns null for null/undefined/empty/whitespace-only", () => {
  assert.equal(blindIndex(null), null);
  assert.equal(blindIndex(undefined), null);
  assert.equal(blindIndex(""), null);
  assert.equal(blindIndex("   "), null);
});

test("encryptFields encrypts every field and preserves nulls", () => {
  const out = encryptFields({
    nombre: "Lorenzo",
    apellido: "Martínez",
    tel: null,
    email: undefined,
  });
  assert.ok(out.nombre && out.nombre.startsWith("\\x"));
  assert.ok(out.apellido && out.apellido.startsWith("\\x"));
  assert.equal(out.tel, null);
  assert.equal(out.email, null);
  assert.equal(decryptColumn(out.nombre), "Lorenzo");
  assert.equal(decryptColumn(out.apellido), "Martínez");
});

test("generateKeyBase64 produces a 32-byte base64 key", () => {
  const key = generateKeyBase64();
  const buf = Buffer.from(key, "base64");
  assert.equal(buf.length, 32, "must be exactly 32 bytes (256 bits) for AES-256");
});

test("encrypted columns are NOT a deterministic function of the plaintext (no leak by equality)", () => {
  const a = encryptColumn("Carlos Vega")!;
  const b = encryptColumn("Carlos Vega")!;
  const c = encryptColumn("Carlos Vega")!;
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

/**
 * CLINICA-3 (hallazgo C) — degradación de `aceptarPedido` ante ciphertext
 * corrupto: el listado (listPedidos) degrada con tryDecrypt, pero el acepte
 * usaba decryptColumn crudo → el pedido se LISTABA y "Aceptar" tiraba una
 * excepción no manejada (500) fuera del contrato Result.
 *
 * Acá se verifica la cadena completa con un fixture REAL de ciphertext
 * corrupto: decryptColumn throwea (el viejo 500), tryDecrypt degrada a null,
 * y `pedidoIlegibleParaAceptar` (decisión pura extraída del acepte) corta con
 * err("validation") solo cuando nombre Y teléfono son ilegibles y no hay
 * paciente existente que reutilizar.
 */

// Cargar .env.local ANTES de importar lib/crypto (mismo patrón que
// crypto-roundtrip.test.ts): las claves AES se leen lazy pero defensivo.
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

import { decryptColumn, encryptColumn, tryDecrypt } from "../../lib/crypto";
import { pedidoIlegibleParaAceptar } from "../../lib/db/pedidos";

/** Fixture: ciphertext válido con el auth tag pisoteado (GCM va a rechazar). */
function corruptCiphertext(plaintext: string): string {
  const wire = encryptColumn(plaintext)!; // "\\x<hex>"
  // Bytes 12..27 son el auth tag (IV_LEN=12, TAG_LEN=16) → hex chars 24..56
  // después de "\\x". Los invertimos para garantizar fallo de autenticación.
  const hex = wire.slice(2);
  const tag = hex.slice(24, 56);
  const tagFlipped = tag
    .split("")
    .map((c) => (c === "0" ? "f" : "0"))
    .join("");
  return "\\x" + hex.slice(0, 24) + tagFlipped + hex.slice(56);
}

test("fixture corrupto: decryptColumn crudo THROWEA (el viejo path del 500)", () => {
  const corrupt = corruptCiphertext("Juan Pérez");
  assert.throws(() => decryptColumn(corrupt));
});

test("fixture corrupto: tryDecrypt degrada a null sin tirar", () => {
  const corrupt = corruptCiphertext("Juan Pérez");
  assert.equal(tryDecrypt(corrupt, "test.pedido.nombre"), null);
});

test("nombre Y teléfono ilegibles + sin paciente existente → pedido NO aceptable", () => {
  const nombre = tryDecrypt(corruptCiphertext("Juan Pérez"), "test.nombre");
  const telefono = tryDecrypt(corruptCiphertext("+54 9 351 555 0000"), "test.tel");
  assert.equal(
    pedidoIlegibleParaAceptar({ nombre, telefono, pacienteId: null }),
    true,
  );
});

test("nombre Y teléfono ilegibles PERO con paciente existente → aceptable (el core lo reutiliza)", () => {
  assert.equal(
    pedidoIlegibleParaAceptar({
      nombre: null,
      telefono: null,
      pacienteId: "eeeeeeee-0000-0000-0000-000000000005",
    }),
    false,
  );
});

test("con al menos un dato legible → aceptable (degradación parcial)", () => {
  const telefono = tryDecrypt(encryptColumn("+54 9 351 555 0000"), "test.tel");
  assert.equal(
    pedidoIlegibleParaAceptar({ nombre: null, telefono, pacienteId: null }),
    false,
  );
  assert.equal(
    pedidoIlegibleParaAceptar({ nombre: "Juan Pérez", telefono: null, pacienteId: null }),
    false,
  );
});

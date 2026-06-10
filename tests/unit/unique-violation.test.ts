/**
 * M5 (docs/AUDIT.md): la idempotencia del webhook de cargos detecta el
 * duplicado por SQLSTATE 23505, no por substring del mensaje. Estos tests
 * fijan el contrato de `isUniqueViolation` — si alguien lo vuelve a acoplar
 * al texto del error, acá se nota.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isUniqueViolation } from "../../lib/db/errors";

test("23505 es unique violation aunque el mensaje cambie de idioma/forma", () => {
  assert.equal(isUniqueViolation({ code: "23505", message: "llave duplicada viola restricción" }), true);
  assert.equal(isUniqueViolation({ code: "23505", message: "" }), true);
  assert.equal(isUniqueViolation({ code: "23505" }), true);
});

test("fallback por mensaje 'duplicate key' cuando el driver no propaga code", () => {
  assert.equal(
    isUniqueViolation({ message: 'duplicate key value violates unique constraint "cargo_suscripcion_mp_payment_id_key"' }),
    true,
  );
});

test("otros errores NO son unique violation", () => {
  assert.equal(isUniqueViolation({ code: "23503", message: "foreign key violation" }), false);
  assert.equal(isUniqueViolation({ code: "42501", message: "permission denied" }), false);
  assert.equal(isUniqueViolation({ message: "network error" }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { ESTADOS_REAGENDABLES, puedeReagendarEstado } from "../../lib/db/turnos";

// ─── puedeReagendarEstado (pura) ──────────────────────────────────────────
//
// El set permitido refleja la matriz REAL del trigger turno_record_transition
// (M09, security definer desde M47):
//
//   AGENDADO   → ... | REAGENDADO
//   CONFIRMADO → ... | REAGENDADO
//   NO_ASISTIO → REAGENDADO        (carve-out: re-citar a un no-show)
//
// EN_SALA / ATENDIENDO / CERRADO / CANCELADO / REAGENDADO no tienen arista
// hacia REAGENDADO — el trigger los rechaza con RAISE EXCEPTION; acá los
// cortamos antes con un mensaje claro.

test("puedeReagendarEstado: AGENDADO y CONFIRMADO se pueden reagendar", () => {
  assert.equal(puedeReagendarEstado("AGENDADO"), true);
  assert.equal(puedeReagendarEstado("CONFIRMADO"), true);
});

test("puedeReagendarEstado: NO_ASISTIO se puede reagendar (matriz M09 lo permite)", () => {
  assert.equal(puedeReagendarEstado("NO_ASISTIO"), true);
});

test("puedeReagendarEstado: estados sin arista a REAGENDADO se rechazan", () => {
  for (const estado of ["EN_SALA", "ATENDIENDO", "CERRADO", "CANCELADO", "REAGENDADO"]) {
    assert.equal(puedeReagendarEstado(estado), false, `${estado} no debería ser reagendable`);
  }
});

test("puedeReagendarEstado: valores basura / casing distinto se rechazan", () => {
  assert.equal(puedeReagendarEstado(""), false);
  assert.equal(puedeReagendarEstado("agendado"), false); // el enum DB es MAYÚSCULAS
  assert.equal(puedeReagendarEstado("CUALQUIERA"), false);
});

test("ESTADOS_REAGENDABLES: set exacto según la matriz del trigger M09", () => {
  assert.deepEqual([...ESTADOS_REAGENDABLES].sort(), ["AGENDADO", "CONFIRMADO", "NO_ASISTIO"]);
});

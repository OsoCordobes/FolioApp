import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoConfirmDecision,
  buildTurnoOrigenFromCanal,
} from "../../lib/db/pedidos";

// B1 — mapeo canal_pedido → origen_turno. origen_turno solo acepta
// MANUAL/BOOKING/WALK_IN/GOOGLE/WHATSAPP; un canal INSTAGRAM/TELEFONO sin mapear
// rompía el INSERT del turno. El mapa explícito garantiza un origen válido.

test("buildTurnoOrigenFromCanal: WEB → BOOKING", () => {
  assert.equal(buildTurnoOrigenFromCanal("WEB"), "BOOKING");
});

test("buildTurnoOrigenFromCanal: WHATSAPP → WHATSAPP", () => {
  assert.equal(buildTurnoOrigenFromCanal("WHATSAPP"), "WHATSAPP");
});

test("buildTurnoOrigenFromCanal: INSTAGRAM → BOOKING (no es origen válido)", () => {
  assert.equal(buildTurnoOrigenFromCanal("INSTAGRAM"), "BOOKING");
});

test("buildTurnoOrigenFromCanal: TELEFONO → MANUAL (no es origen válido)", () => {
  assert.equal(buildTurnoOrigenFromCanal("TELEFONO"), "MANUAL");
});

test("buildTurnoOrigenFromCanal: canal desconocido → MANUAL (default seguro)", () => {
  assert.equal(buildTurnoOrigenFromCanal("FAX"), "MANUAL");
  assert.equal(buildTurnoOrigenFromCanal(""), "MANUAL");
});

// Decisión de auto-confirmación: solo si la org lo activó Y hay profesional.

test("buildAutoConfirmDecision: activo + profesional → auto-confirma", () => {
  const d = buildAutoConfirmDecision(
    { auto_confirmar_reservas: true },
    { profesional_id: "11111111-1111-1111-1111-111111111111" },
  );
  assert.equal(d.shouldAutoConfirm, true);
  assert.equal(d.profesionalId, "11111111-1111-1111-1111-111111111111");
});

test("buildAutoConfirmDecision: activo + sin profesional → NO auto-confirma", () => {
  const d = buildAutoConfirmDecision(
    { auto_confirmar_reservas: true },
    { profesional_id: null },
  );
  assert.equal(d.shouldAutoConfirm, false);
  assert.equal(d.profesionalId, null);
});

test("buildAutoConfirmDecision: desactivado → NO auto-confirma (aunque haya profesional)", () => {
  const d = buildAutoConfirmDecision(
    { auto_confirmar_reservas: false },
    { profesional_id: "22222222-2222-2222-2222-222222222222" },
  );
  assert.equal(d.shouldAutoConfirm, false);
  assert.equal(d.profesionalId, "22222222-2222-2222-2222-222222222222");
});

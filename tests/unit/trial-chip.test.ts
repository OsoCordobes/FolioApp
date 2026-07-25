/**
 * Tests · computeTrialChip (E3 · chip "Prueba: quedan N días").
 *
 * Cubre las decisiones puras del chip de trial en la navegación:
 * quién lo ve (solo OWNER, nunca cuentas internas), cuándo (solo con días
 * de gracia > 0) y con qué tono (urgente recién con ≤7 días).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Role } from "../../lib/auth/capabilities";
import {
  computeTrialChip,
  TRIAL_CHIP_URGENT_DAYS,
  type TrialChipView,
} from "../../lib/billing/trial-chip";

function shown(view: TrialChipView): asserts view is Extract<TrialChipView, { show: true }> {
  assert.equal(view.show, true);
}

// ─── Quién lo ve ────────────────────────────────────────────────────────────

test("OWNER en trial con días restantes → se muestra", () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: 20 });
  shown(view);
  assert.equal(view.days, 20);
});

for (const role of ["DIRECTOR", "PROFESIONAL", "COORDINADOR", "ASISTENTE"] as Role[]) {
  test(`rol ${role} nunca ve el chip (no puede activar la suscripción)`, () => {
    assert.deepEqual(computeTrialChip({ role, graceDaysLeft: 3 }), { show: false });
  });
}

test("cuenta interna (M37) nunca ve el chip, ni siendo OWNER con pocos días", () => {
  assert.deepEqual(
    computeTrialChip({ role: "OWNER", graceDaysLeft: 2, isInternalAccount: true }),
    { show: false },
  );
});

// ─── Cuándo ─────────────────────────────────────────────────────────────────

test("suscripción activa (graceDaysLeft null) → nada que avisar", () => {
  assert.deepEqual(computeTrialChip({ role: "OWNER", graceDaysLeft: null }), { show: false });
});

test("trial vencido (0 días) → nada: el gate ya redirige a billing", () => {
  assert.deepEqual(computeTrialChip({ role: "OWNER", graceDaysLeft: 0 }), { show: false });
});

test("días negativos (defensivo) → oculto", () => {
  assert.deepEqual(computeTrialChip({ role: "OWNER", graceDaysLeft: -3 }), { show: false });
});

// ─── Tono ───────────────────────────────────────────────────────────────────

test(`con más de ${TRIAL_CHIP_URGENT_DAYS} días el tono es discreto (no urgente)`, () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: TRIAL_CHIP_URGENT_DAYS + 1 });
  shown(view);
  assert.equal(view.urgent, false);
});

test(`con exactamente ${TRIAL_CHIP_URGENT_DAYS} días pasa a urgente (amber)`, () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: TRIAL_CHIP_URGENT_DAYS });
  shown(view);
  assert.equal(view.urgent, true);
});

test("con 1 día es urgente", () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: 1 });
  shown(view);
  assert.equal(view.urgent, true);
});

// ─── Copy ───────────────────────────────────────────────────────────────────

test("label plural: 'Prueba: quedan N días'", () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: 12 });
  shown(view);
  assert.equal(view.label, "Prueba: quedan 12 días");
});

test("label singular: 'Prueba: queda 1 día'", () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: 1 });
  shown(view);
  assert.equal(view.label, "Prueba: queda 1 día");
});

test("días fraccionales se truncan hacia abajo (piso honesto)", () => {
  const view = computeTrialChip({ role: "OWNER", graceDaysLeft: 7.9 });
  shown(view);
  assert.equal(view.days, 7);
  assert.equal(view.urgent, true);
});

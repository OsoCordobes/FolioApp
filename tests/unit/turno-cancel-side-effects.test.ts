import assert from "node:assert/strict";
import test from "node:test";

import { ESTADOS_CANCELAN_SIDE_EFFECTS } from "../../lib/db/turnos";

// ─── ESTADOS_CANCELAN_SIDE_EFFECTS ──────────────────────────────────────────
//
// CLINICA-3 (hallazgo E): NO_ASISTIO no cancelaba el evento de Google
// Calendar ni los recordatorios pendientes — solo CANCELADO/REAGENDADO lo
// hacían, y el calendar del médico quedaba mintiendo un turno que no ocurrió.
//
// transitionTurno (lib/db/turnos.ts) dispara cancelRecordatoriosForTurno +
// cancelTurnoEnGoogle vía runAfterResponse cuando el destino está en este
// set; no hay harness de hooks para ejercitar los side-effects en unit tests
// (requieren DB + Google), así que el contrato testeable es el set mismo,
// igual que ESTADOS_REAGENDABLES en reagendar-estados.test.ts.

test("NO_ASISTIO cancela side-effects (gcal + recordatorios), junto a CANCELADO y REAGENDADO", () => {
  for (const estado of ["CANCELADO", "REAGENDADO", "NO_ASISTIO"]) {
    assert.ok(
      (ESTADOS_CANCELAN_SIDE_EFFECTS as readonly string[]).includes(estado),
      `${estado} debe cancelar recordatorios + evento gcal`,
    );
  }
});

test("estados vivos o de cierre normal NO cancelan side-effects", () => {
  for (const estado of ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO", "CERRADO"]) {
    assert.ok(
      !(ESTADOS_CANCELAN_SIDE_EFFECTS as readonly string[]).includes(estado),
      `${estado} no debería cancelar side-effects`,
    );
  }
});

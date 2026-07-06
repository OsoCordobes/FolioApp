import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTADOS_CANCELABLES_PACIENTE,
  propuestaSolapa,
  puedeCancelarPaciente,
} from "../../lib/db/portal-turnos";

// ═══════════════════════════════════════════════════════════════════════════════
// Folio · P4 · self-service de turnos del portal — helpers puros
//
// Verifican la VENTANA DE CORTE de cancelación y el rechazo de doble-booking del
// pre-check de reagenda. La verdad dura la fijan la policy turno_cancel_portal + el
// trigger-guard M84 + la máquina de estados M09 + el EXCLUDE M40; estos tests
// cubren la copia pura que da feedback al paciente antes del round-trip.
// ═══════════════════════════════════════════════════════════════════════════════

const HORA = 60 * 60_000;
const NOW = Date.parse("2026-07-06T12:00:00-03:00");

// ─── puedeCancelarPaciente · ventana de corte ────────────────────────────────

test("cancelar: turno CONFIRMADO bien afuera de la ventana (48h > cutoff 24h) → permite", () => {
  const r = puedeCancelarPaciente({
    estado: "CONFIRMADO",
    inicioMs: NOW + 48 * HORA,
    nowMs: NOW,
    cutoffHoras: 24,
  });
  assert.deepEqual(r, { ok: true });
});

test("cancelar: turno AGENDADO justo dentro de la ventana (12h < cutoff 24h) → rechaza por ventana", () => {
  const r = puedeCancelarPaciente({
    estado: "AGENDADO",
    inicioMs: NOW + 12 * HORA,
    nowMs: NOW,
    cutoffHoras: 24,
  });
  assert.deepEqual(r, { ok: false, reason: "ventana" });
});

test("cancelar: turno exactamente en el borde del cutoff (inicio = now + 24h) → rechaza (half-open, <=)", () => {
  // El trigger-guard usa `inicio <= now + cutoff` para RAISE; el helper debe
  // coincidir: en el borde exacto NO se puede cancelar (defensa consistente).
  const r = puedeCancelarPaciente({
    estado: "CONFIRMADO",
    inicioMs: NOW + 24 * HORA,
    nowMs: NOW,
    cutoffHoras: 24,
  });
  assert.deepEqual(r, { ok: false, reason: "ventana" });
});

test("cancelar: un segundo MÁS ALLÁ del borde del cutoff → permite", () => {
  const r = puedeCancelarPaciente({
    estado: "CONFIRMADO",
    inicioMs: NOW + 24 * HORA + 1000,
    nowMs: NOW,
    cutoffHoras: 24,
  });
  assert.deepEqual(r, { ok: true });
});

test("cancelar: cutoff 0h (sin ventana) → cualquier turno futuro se puede cancelar", () => {
  const r = puedeCancelarPaciente({
    estado: "AGENDADO",
    inicioMs: NOW + 60_000, // 1 min en el futuro
    nowMs: NOW,
    cutoffHoras: 0,
  });
  assert.deepEqual(r, { ok: true });
});

test("cancelar: turno EN_SALA (en curso) → rechaza por estado, aunque esté lejísimos", () => {
  const r = puedeCancelarPaciente({
    estado: "EN_SALA",
    inicioMs: NOW + 100 * HORA,
    nowMs: NOW,
    cutoffHoras: 24,
  });
  assert.deepEqual(r, { ok: false, reason: "estado" });
});

test("cancelar: estados terminales/en-curso NO son cancelables por el paciente", () => {
  for (const estado of ["ATENDIENDO", "CERRADO", "NO_ASISTIO", "CANCELADO", "REAGENDADO"]) {
    const r = puedeCancelarPaciente({
      estado,
      inicioMs: NOW + 72 * HORA,
      nowMs: NOW,
      cutoffHoras: 24,
    });
    assert.deepEqual(r, { ok: false, reason: "estado" }, `estado ${estado} no debe ser cancelable`);
  }
});

test("cancelar: la whitelist de estados cancelables es exactamente {AGENDADO, CONFIRMADO}", () => {
  assert.deepEqual([...ESTADOS_CANCELABLES_PACIENTE], ["AGENDADO", "CONFIRMADO"]);
});

test("cancelar: cutoffHoras negativo se trata como 0 (no habilita el pasado)", () => {
  // Defensa: un cutoff inválido no debe permitir cancelar un turno ya pasado.
  const r = puedeCancelarPaciente({
    estado: "CONFIRMADO",
    inicioMs: NOW - HORA, // ya pasó
    nowMs: NOW,
    cutoffHoras: -5,
  });
  assert.equal(r.ok, false);
});

// ─── propuestaSolapa · rechazo de doble-booking ──────────────────────────────

const vivos = [
  // turno vivo A: 10:00–10:45
  { id: "A", inicioMs: Date.parse("2026-07-08T10:00:00-03:00"), finMs: Date.parse("2026-07-08T10:45:00-03:00") },
  // turno vivo B: 15:00–16:00
  { id: "B", inicioMs: Date.parse("2026-07-08T15:00:00-03:00"), finMs: Date.parse("2026-07-08T16:00:00-03:00") },
];

test("reagenda: propuesta 10:30–11:15 solapa con A (10:00–10:45) → true", () => {
  const inicio = Date.parse("2026-07-08T10:30:00-03:00");
  const fin = Date.parse("2026-07-08T11:15:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, vivos), true);
});

test("reagenda: propuesta 11:00–11:45 (entre A y B) → false (libre)", () => {
  const inicio = Date.parse("2026-07-08T11:00:00-03:00");
  const fin = Date.parse("2026-07-08T11:45:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, vivos), false);
});

test("reagenda: propuesta que arranca exactamente al fin de A (10:45) → false (half-open)", () => {
  const inicio = Date.parse("2026-07-08T10:45:00-03:00");
  const fin = Date.parse("2026-07-08T11:30:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, vivos), false);
});

test("reagenda: propuesta que solapa B → true", () => {
  const inicio = Date.parse("2026-07-08T15:30:00-03:00");
  const fin = Date.parse("2026-07-08T16:30:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, vivos), true);
});

test("reagenda: excludeTurnoId ignora el propio turno que se está moviendo", () => {
  // Mover el turno A a 10:15 solapa con su propio rango viejo; excluyéndolo, libre.
  const inicio = Date.parse("2026-07-08T10:15:00-03:00");
  const fin = Date.parse("2026-07-08T11:00:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, vivos, "A"), false);
  // Sin excluir, sí solapa (contra A).
  assert.equal(propuestaSolapa(inicio, fin, vivos), true);
});

test("reagenda: excludeTurnoId NO enmascara conflicto con OTRO turno vivo", () => {
  // Excluir A no debe permitir pisar B.
  const inicio = Date.parse("2026-07-08T15:30:00-03:00");
  const fin = Date.parse("2026-07-08T16:30:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, vivos, "A"), true);
});

test("reagenda: sin turnos vivos → nunca solapa", () => {
  const inicio = Date.parse("2026-07-08T10:00:00-03:00");
  const fin = Date.parse("2026-07-08T11:00:00-03:00");
  assert.equal(propuestaSolapa(inicio, fin, []), false);
});

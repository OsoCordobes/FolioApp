import assert from "node:assert/strict";
import test from "node:test";

import { err, ok } from "../../lib/db/errors";
import {
  adaptarFallbackOrgPortal,
  decideProfesionalPorServicio,
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

// ─── decideProfesionalPorServicio · reserva nueva del portal ─────────────────
//
// La relación profesional↔servicio es la tabla M:N servicio_profesional (M02);
// `servicio` NO tiene columna profesional_id (el select viejo con esa columna
// rebotaba 42703 y TODA reserva caía al fallback silencioso). Regla: exactamente
// 1 vinculado válido → ese; 0 o varios → fallback a la resolución org-level del
// booking público (resolveProfesionalPublico).

const PROF_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROF_B = "bbbbbbbb-0000-0000-0000-000000000002";

test("reserva: servicio con exactamente 1 profesional vinculado → usar ese", () => {
  assert.deepEqual(decideProfesionalPorServicio([PROF_A]), {
    kind: "usar",
    profesionalId: PROF_A,
  });
});

test("reserva: servicio sin profesionales vinculados → fallback org-level (booking público)", () => {
  assert.deepEqual(decideProfesionalPorServicio([]), { kind: "fallback_org" });
});

test("reserva: servicio con varios vinculados → fallback org-level, NUNCA un 'primero' arbitrario", () => {
  assert.deepEqual(decideProfesionalPorServicio([PROF_A, PROF_B]), {
    kind: "fallback_org",
  });
});

// ─── adaptarFallbackOrgPortal · degradación multi-profesional a NULL ─────────
//
// En el booking público, err("validation") ("elegí con qué profesional…") es
// recuperable: el wizard muestra el picker. El portal NO tiene picker
// (nuevaReservaSchema no pide profesionalId), así que ese err era un dead-end
// terminal para clínicas multi-profesional con servicios de 0 o ≥2 vinculados.
// La adaptación degrada a profesional_id NULL (el staff asigna al aceptar,
// resolverProfesionalDelPedido). Los demás resultados pasan tal cual.

test("fallback portal: único colegiado resuelto (ok) → pasa tal cual", () => {
  assert.deepEqual(adaptarFallbackOrgPortal(ok(PROF_A)), ok(PROF_A));
});

test("fallback portal: varios colegiados (err validation 'hay que elegir') → degrada a NULL, NO dead-end", () => {
  const res = adaptarFallbackOrgPortal(
    err("validation", "Elegí con qué profesional querés atenderte."),
  );
  assert.deepEqual(res, ok(null));
});

test("fallback portal: org sin colegiados (err not_found) → pasa tal cual (nadie podría aceptar el pedido)", () => {
  const res = adaptarFallbackOrgPortal(err("not_found", "Sin profesional disponible."));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "not_found");
});

test("fallback portal: error de infraestructura (db_error) → pasa tal cual, no se enmascara como NULL", () => {
  const res = adaptarFallbackOrgPortal(err("db_error", "Error en la base de datos.", "boom"));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "db_error");
});

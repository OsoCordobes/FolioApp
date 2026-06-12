import assert from "node:assert/strict";
import test from "node:test";

import { deriveDiasCerrados, type DisponibilidadVigencia } from "../../lib/db/calendario";

/**
 * Semana de referencia: lunes 2026-06-08 … domingo 2026-06-14.
 * (La demo con el primer cliente cae el DOMINGO 14.)
 */
const WEEK = [
  "2026-06-08", // LUN (i=0)
  "2026-06-09", // MAR
  "2026-06-10", // MIÉ
  "2026-06-11", // JUE
  "2026-06-12", // VIE
  "2026-06-13", // SÁB (i=5)
  "2026-06-14", // DOM (i=6)
];

const franja = (
  diaSemana: number,
  vigenciaDesde = "2026-01-01",
  vigenciaHasta: string | null = null,
): DisponibilidadVigencia => ({ diaSemana, vigenciaDesde, vigenciaHasta });

const SIN_EVENTOS = new Set<string>();

test("sin disponibilidad ni eventos → idéntico al hardcode histórico (solo sáb/dom cerrados)", () => {
  assert.deepEqual(deriveDiasCerrados(WEEK, [], SIN_EVENTOS), [
    false, false, false, false, false, true, true,
  ]);
});

test("disponibilidad lun-vie (DB dow 1..5) no abre el finde — baseline intacto", () => {
  const disp = [1, 2, 3, 4, 5].map((d) => franja(d));
  assert.deepEqual(deriveDiasCerrados(WEEK, disp, SIN_EVENTOS), [
    false, false, false, false, false, true, true,
  ]);
});

test("franja activa el domingo (DB dia_semana=0) abre el DOM", () => {
  const out = deriveDiasCerrados(WEEK, [franja(0)], SIN_EVENTOS);
  assert.equal(out[6], false); // DOM abierto
  assert.equal(out[5], true);  // SÁB sigue cerrado
});

test("franja activa el sábado (DB dia_semana=6) abre el SÁB", () => {
  const out = deriveDiasCerrados(WEEK, [franja(6)], SIN_EVENTOS);
  assert.equal(out[5], false);
  assert.equal(out[6], true);
});

test("mapeo índice UI → DB: la franja de lunes (1) jamás abre sáb/dom", () => {
  const out = deriveDiasCerrados(WEEK, [franja(1)], SIN_EVENTOS);
  assert.equal(out[0], false); // LUN nunca va gris (regla baseline)
  assert.equal(out[5], true);
  assert.equal(out[6], true);
});

test("vigencia: franja de domingo vencida antes de la semana NO abre el DOM", () => {
  const disp = [franja(0, "2026-01-01", "2026-05-31")];
  assert.equal(deriveDiasCerrados(WEEK, disp, SIN_EVENTOS)[6], true);
});

test("vigencia: franja de domingo que arranca después de la semana NO abre el DOM", () => {
  const disp = [franja(0, "2026-07-01", null)];
  assert.equal(deriveDiasCerrados(WEEK, disp, SIN_EVENTOS)[6], true);
});

test("vigencia: franja vigente exactamente en los bordes abre el día", () => {
  // vigencia_desde = el mismo domingo; vigencia_hasta = el mismo domingo.
  const disp = [franja(0, "2026-06-14", "2026-06-14")];
  assert.equal(deriveDiasCerrados(WEEK, disp, SIN_EVENTOS)[6], false);
});

test("un turno en un día 'cerrado' lo abre aunque no haya disponibilidad", () => {
  const eventos = new Set(["2026-06-14"]);
  const out = deriveDiasCerrados(WEEK, [], eventos);
  assert.equal(out[6], false); // DOM con turno → se muestra normal
  assert.equal(out[5], true);
});

test("eventos en días de semana no cambian nada (nunca van grises)", () => {
  const eventos = new Set(["2026-06-10"]);
  assert.deepEqual(deriveDiasCerrados(WEEK, [], eventos), [
    false, false, false, false, false, true, true,
  ]);
});

// ─── Multi-profesional (modo clínica) ───────────────────────────────────────
// En vista "Todos" el fetcher pasa las franjas de TODA la org (unión): un día
// queda cerrado solo si NINGÚN colegiado tiene franja. Con filtro activo pasa
// solo las del profesional filtrado (la query agrega .eq member_id).

test("unión multi-prof: sábado del quiropráctico + domingo de la psicóloga abren AMBOS días", () => {
  // Prof A (quiro) atiende sábado (DB 6); Prof B (psico) atiende domingo (DB 0).
  const franjasOrg = [franja(6), franja(0)];
  const out = deriveDiasCerrados(WEEK, franjasOrg, SIN_EVENTOS);
  assert.equal(out[5], false); // SÁB abierto (lo abre A)
  assert.equal(out[6], false); // DOM abierto (lo abre B)
});

test("unión multi-prof: si ningún colegiado tiene franja de finde, el finde queda cerrado", () => {
  // Tres profesionales, todos lun-vie.
  const franjasOrg = [1, 2, 3, 4, 5].flatMap((d) => [franja(d), franja(d), franja(d)]);
  assert.deepEqual(deriveDiasCerrados(WEEK, franjasOrg, SIN_EVENTOS), [
    false, false, false, false, false, true, true,
  ]);
});

test("filtro activo: con SOLO las franjas del profesional filtrado, deriva de SU agenda", () => {
  // La org completa abre sábado y domingo (unión)…
  const franjasOrg = [franja(6), franja(0)];
  assert.deepEqual(deriveDiasCerrados(WEEK, franjasOrg, SIN_EVENTOS).slice(5), [false, false]);
  // …pero filtrado al prof que solo atiende sábado, el domingo vuelve a cerrarse.
  const franjasProfA = [franja(6)];
  const out = deriveDiasCerrados(WEEK, franjasProfA, SIN_EVENTOS);
  assert.equal(out[5], false);
  assert.equal(out[6], true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { closeDuration, mergeFinancialTurno, paymentToCobro, withCloseStatus } from "../../lib/hoy/close-operation";
import { computeCobroKpi } from "../../lib/hoy/kpi-cobro";
import type { Turno } from "../../lib/types";
import type { CloseStatus } from "../../lib/turnos/close-contract";

const turno: Turno = { id: "turno", pacienteId: "patient", hora: "12:00", servicio: "Consulta", precio: 500,
  estado: "cerrado", duracionMin: 25, postVisita: { guardada: false } };
const pending = { id: "payment", estado: "pendiente" as const, ts: null, montoCents: 10000, updatedAt: "2026-09-12T12:00:00Z", metodo: "EFECTIVO" };
const paid = { ...pending, estado: "pagado" as const, ts: "2026-09-12T12:01:00Z", updatedAt: "2026-09-12T12:01:00Z" };
test("same-payment old ACK and equal-state SSR cannot replace a newer settled payment", () => {
  for (const estado of ["atendiendo", "cerrado"] as const) {
    const result = mergeFinancialTurno({ ...turno, cobro: paid }, { ...turno, estado, cobro: pending });
    assert.deepEqual(result.cobro, paid); assert.equal(result.cobroPorRevisar, true);
    assert.equal(computeCobroKpi([result]).cobradoPesos, 100);
  }
});
test("only a fresh authorized read can resolve a changed paid record; no irreversible rule", () => {
  const corrected = { ...pending, montoCents: 9000, updatedAt: "2026-09-12T12:02:00Z" };
  const uncertain = mergeFinancialTurno({ ...turno, cobro: paid }, { ...turno, cobro: corrected });
  assert.deepEqual(uncertain.cobro, paid); assert.equal(uncertain.cobroPorRevisar, true);
  const result = mergeFinancialTurno({ ...turno, cobro: paid }, { ...turno, cobro: corrected }, true);
  assert.deepEqual(result.cobro, corrected); assert.equal(computeCobroKpi([result]).deudaPesos, 90);
});
test("different identity, missing timestamps, equal timestamp contradiction or missing row require review", () => {
  for (const next of [{ ...pending, id: "other" }, { ...pending, updatedAt: undefined }, { ...pending, updatedAt: paid.updatedAt }, undefined]) {
    const result = mergeFinancialTurno({ ...turno, cobro: paid }, { ...turno, cobro: next });
    assert.deepEqual(result.cobro, paid); assert.equal(result.cobroPorRevisar, true);
  }
});
test("a fresh authorized read resolves ambiguous transaction-start timestamps", () => {
  const result = mergeFinancialTurno({ ...turno, cobro: paid, cobroPorRevisar: true }, { ...turno, cobro: pending }, true);
  assert.deepEqual(result.cobro, pending); assert.equal(result.cobroPorRevisar, false);
});
test("SSR omission preserves explicit free classification without inventing debt", () => {
  const result = mergeFinancialTurno({ ...turno, cierreClasificacion: "SIN_CARGO" }, turno);
  assert.equal(result.cierreClasificacion, "SIN_CARGO"); assert.equal(computeCobroKpi([result]).porCobrarPesos, 0);
});
test("status redaction and unregistered are not evidence of free care or a debt", () => {
  for (const clasificacion of ["REQUIERE_REGISTRO", "REGISTRADO"] as const) {
    const status: CloseStatus = { turnoId: turno.id, estado: "CERRADO", closedAt: null, origen: "HISTORICO", clasificacion, pago: null, puedeRegistrar: false };
    const result = withCloseStatus(turno, status); assert.equal(result.cierreClasificacion, clasificacion);
    assert.equal(computeCobroKpi([result]).deudaCount, 0); assert.equal(computeCobroKpi([result]).cobradoPesos, 0);
  }
});
test("projection preserves persisted payment identity, method and timestamps", () => {
  assert.deepEqual(paymentToCobro({ id: paid.id, montoCents: paid.montoCents, metodo: "EFECTIVO", estado: "PAGADO", pagadoTs: paid.ts, updatedAt: paid.updatedAt }), paid);
});
test("duration snapshot exposes long, invalid or future starts for user correction without clipping", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  assert.equal(closeDuration({ ...turno, atendiendoDesde: "2026-09-12T02:00:00Z" }, now), 600);
  assert.equal(closeDuration({ ...turno, atendiendoDesde: "2026-09-12T12:01:00Z" }, now), -1);
  assert.equal(closeDuration({ ...turno, atendiendoDesde: "2026-09-12T12:00:00Z" }, now), 0);
  assert.equal(Number.isNaN(closeDuration({ ...turno, atendiendoDesde: "invalid" }, now)), true);
});

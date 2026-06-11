import assert from "node:assert/strict";
import test from "node:test";

import { decideSlotOcupado, slotRangesOverlap } from "../../lib/db/turnos";

// ─── slotRangesOverlap (pura) ────────────────────────────────────────────

test("slotRangesOverlap: rangos disjuntos no se solapan", () => {
  // [0,10) vs [10,20) — tocan en el borde pero no solapan (half-open)
  assert.equal(slotRangesOverlap(0, 10, 10, 20), false);
  assert.equal(slotRangesOverlap(10, 20, 0, 10), false);
});

test("slotRangesOverlap: rangos que se cruzan parcialmente solapan", () => {
  assert.equal(slotRangesOverlap(0, 10, 5, 15), true);
  assert.equal(slotRangesOverlap(5, 15, 0, 10), true);
});

test("slotRangesOverlap: rango contenido solapa", () => {
  assert.equal(slotRangesOverlap(0, 100, 40, 60), true);
  assert.equal(slotRangesOverlap(40, 60, 0, 100), true);
});

test("slotRangesOverlap: rangos idénticos solapan", () => {
  assert.equal(slotRangesOverlap(0, 10, 0, 10), true);
});

// ─── decideSlotOcupado (pura) ────────────────────────────────────────────

const baseMs = new Date("2026-06-01T10:00:00.000Z").getTime();
const slotInicio = baseMs;
const slotFin = baseMs + 45 * 60_000; // 45min

test("decideSlotOcupado: sin candidatos → libre", () => {
  assert.equal(
    decideSlotOcupado(slotInicio, slotFin, { turnos: null, pedidos: null, bloqueos: null }),
    false,
  );
});

test("decideSlotOcupado: turno solapado → ocupado", () => {
  const ocupado = decideSlotOcupado(slotInicio, slotFin, {
    turnos: [{ inicio: new Date(baseMs + 15 * 60_000).toISOString(), duracion_min: 30 }],
    pedidos: null,
    bloqueos: null,
  });
  assert.equal(ocupado, true);
});

test("decideSlotOcupado: turno adyacente (termina justo al empezar) → libre", () => {
  const ocupado = decideSlotOcupado(slotInicio, slotFin, {
    turnos: [{ inicio: new Date(baseMs - 30 * 60_000).toISOString(), duracion_min: 30 }],
    pedidos: null,
    bloqueos: null,
  });
  assert.equal(ocupado, false);
});

test("decideSlotOcupado: pedido pendiente solapado (campo fecha_propuesta) → ocupado", () => {
  const ocupado = decideSlotOcupado(slotInicio, slotFin, {
    turnos: null,
    pedidos: [{ fecha_propuesta: new Date(baseMs + 10 * 60_000).toISOString(), duracion_min: 60 }],
    bloqueos: null,
  });
  assert.equal(ocupado, true);
});

test("decideSlotOcupado: bloqueo solapado → ocupado", () => {
  const ocupado = decideSlotOcupado(slotInicio, slotFin, {
    turnos: null,
    pedidos: null,
    bloqueos: [{ inicio: new Date(baseMs).toISOString(), duracion_min: 120 }],
  });
  assert.equal(ocupado, true);
});

test("decideSlotOcupado: candidatos no solapados → libre", () => {
  const ocupado = decideSlotOcupado(slotInicio, slotFin, {
    turnos: [{ inicio: new Date(baseMs + 120 * 60_000).toISOString(), duracion_min: 30 }],
    pedidos: [{ fecha_propuesta: new Date(baseMs - 120 * 60_000).toISOString(), duracion_min: 30 }],
    bloqueos: [],
  });
  assert.equal(ocupado, false);
});

// ─── Exclusión de pedido (M53 — fix del auto-conflicto del booking) ──────
//
// Al promover un pedido a turno, el pedido sigue PENDIENTE con su
// fecha_propuesta solapando el slot por definición. Sin exclusión, TODA
// promoción se auto-conflictuaba y el booking público fallaba siempre.

const PEDIDO_PROPIO = "11111111-1111-1111-1111-111111111111";
const PEDIDO_AJENO = "22222222-2222-2222-2222-222222222222";

test("decideSlotOcupado: el pedido excluido no cuenta como conflicto (auto-conflicto M53)", () => {
  const ocupado = decideSlotOcupado(
    slotInicio,
    slotFin,
    {
      turnos: null,
      pedidos: [{ id: PEDIDO_PROPIO, fecha_propuesta: new Date(baseMs).toISOString(), duracion_min: 45 }],
      bloqueos: null,
    },
    PEDIDO_PROPIO,
  );
  assert.equal(ocupado, false);
});

test("decideSlotOcupado: otro pedido solapado sigue contando aunque haya exclusión", () => {
  const ocupado = decideSlotOcupado(
    slotInicio,
    slotFin,
    {
      turnos: null,
      pedidos: [
        { id: PEDIDO_PROPIO, fecha_propuesta: new Date(baseMs).toISOString(), duracion_min: 45 },
        { id: PEDIDO_AJENO, fecha_propuesta: new Date(baseMs + 10 * 60_000).toISOString(), duracion_min: 45 },
      ],
      bloqueos: null,
    },
    PEDIDO_PROPIO,
  );
  assert.equal(ocupado, true);
});

test("decideSlotOcupado: la exclusión no afecta turnos ni bloqueos", () => {
  const ocupado = decideSlotOcupado(
    slotInicio,
    slotFin,
    {
      turnos: [{ inicio: new Date(baseMs).toISOString(), duracion_min: 30 }],
      pedidos: [{ id: PEDIDO_PROPIO, fecha_propuesta: new Date(baseMs).toISOString(), duracion_min: 45 }],
      bloqueos: null,
    },
    PEDIDO_PROPIO,
  );
  assert.equal(ocupado, true);
});

test("decideSlotOcupado: sin excludePedidoId la semántica original no cambia", () => {
  const ocupado = decideSlotOcupado(slotInicio, slotFin, {
    turnos: null,
    pedidos: [{ id: PEDIDO_PROPIO, fecha_propuesta: new Date(baseMs).toISOString(), duracion_min: 45 }],
    bloqueos: null,
  });
  assert.equal(ocupado, true);
});

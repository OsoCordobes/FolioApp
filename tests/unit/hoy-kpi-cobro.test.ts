import assert from "node:assert/strict";
import test from "node:test";

import {
  cobroOptimistaAlCerrar,
  computeCobroKpi,
  montoRegistradoCents,
  type TurnoCobroLike,
} from "../../lib/hoy/kpi-cobro";

// Hallazgo H3 · el KPI "Recaudado" de /hoy sumaba `precio` de todo turno
// CERRADO. Con el mini-diálogo de cobro (PR #118) el monto real puede ser otro
// (editable) o directamente no cobrarse ("quedó debiendo" ⇒ pago PENDIENTE):
// /hoy declaraba como cobrado dinero que /finanzas no reconoce.

const NOW_ISO = "2026-07-25T13:00:00.000Z";

/** Turno cerrado y cobrado por el precio de lista (camino feliz). */
const cerradoCobrado: TurnoCobroLike = {
  estado: "cerrado",
  precio: 20000,
  cobro: { estado: "pagado", ts: NOW_ISO, montoCents: 2_000_000 },
};

// ─── computeCobroKpi ────────────────────────────────────────────────────────

test("suma el monto REGISTRADO, no el precio del turno (el diálogo lo deja editar)", () => {
  const kpi = computeCobroKpi([
    { estado: "cerrado", precio: 20000, cobro: { estado: "pagado", ts: NOW_ISO, montoCents: 1_500_000 } },
  ]);
  assert.equal(kpi.cobradoPesos, 15000);
  assert.equal(kpi.deudaPesos, 0);
  assert.equal(kpi.porCobrarPesos, 0);
});

test("turno cerrado con deuda: NO cuenta como recaudado, cuenta como por cobrar", () => {
  const kpi = computeCobroKpi([
    { estado: "cerrado", precio: 20000, cobro: { estado: "pendiente", ts: null, montoCents: 2_000_000 } },
  ]);
  assert.equal(kpi.cobradoPesos, 0, "una deuda no es plata cobrada");
  assert.equal(kpi.deudaPesos, 20000);
  assert.equal(kpi.deudaCount, 1);
  assert.equal(kpi.porCobrarPesos, 20000);
});

test("PARCIAL (pago.estado ≠ PAGADO) cuenta como deuda — mismo criterio que /finanzas", () => {
  const kpi = computeCobroKpi([
    { estado: "cerrado", precio: 20000, cobro: { estado: "pendiente", ts: null, montoCents: 500_000 } },
  ]);
  assert.equal(kpi.cobradoPesos, 0);
  assert.equal(kpi.deudaPesos, 5000);
});

test("turno cerrado SIN cargo (monto 0 ⇒ el server no crea `pago`) no suma en ningún lado", () => {
  const kpi = computeCobroKpi([
    { estado: "cerrado", precio: 20000, cobro: { estado: "pendiente", ts: null, montoCents: null } },
  ]);
  assert.equal(kpi.cobradoPesos, 0);
  assert.equal(kpi.deudaPesos, 0);
  assert.equal(kpi.esperadoPesos, 0, "un turno cerrado ya no puede cobrarse");
  assert.equal(kpi.porCobrarPesos, 0);
});

test("turnos por atender suman a 'por cobrar' por precio de lista", () => {
  const kpi = computeCobroKpi([
    { estado: "agendado", precio: 12000, cobro: { estado: "pendiente", ts: null, montoCents: null } },
    { estado: "confirmado", precio: 8000, cobro: { estado: "pendiente", ts: null, montoCents: null } },
    { estado: "en_sala", precio: 5000 },
    { estado: "atendiendo", precio: 1000 },
  ]);
  assert.equal(kpi.esperadoPesos, 26000);
  assert.equal(kpi.porCobrarPesos, 26000);
  assert.equal(kpi.cobradoPesos, 0);
});

test("cancelado / no_asistio / reagendado no esperan ingreso", () => {
  const kpi = computeCobroKpi([
    { estado: "cancelado", precio: 9000 },
    { estado: "no_asistio", precio: 9000 },
    { estado: "reagendado", precio: 9000 },
  ]);
  assert.equal(kpi.esperadoPesos, 0);
  assert.equal(kpi.porCobrarPesos, 0);
});

test("turno futuro YA pagado (pre-pago M09) no se cuenta dos veces", () => {
  const kpi = computeCobroKpi([
    { estado: "confirmado", precio: 10000, cobro: { estado: "pagado", ts: NOW_ISO, montoCents: 1_000_000 } },
  ]);
  assert.equal(kpi.cobradoPesos, 10000);
  assert.equal(kpi.esperadoPesos, 0, "ya está cobrado: no vuelve a sumar en 'por cobrar'");
});

test("día completo: cobrado y por cobrar salen de `pago`, no del estado del turno", () => {
  const kpi = computeCobroKpi([
    cerradoCobrado,
    { estado: "cerrado", precio: 20000, cobro: { estado: "pendiente", ts: null, montoCents: 2_000_000 } },
    { estado: "cerrado", precio: 30000, cobro: { estado: "pagado", ts: NOW_ISO, montoCents: 1_000_000 } },
    { estado: "agendado", precio: 15000, cobro: { estado: "pendiente", ts: null, montoCents: null } },
  ]);
  // Antes: recaudado = 20000+20000+30000 = 70000 (mentira). Ahora: 20000+10000.
  assert.equal(kpi.cobradoPesos, 30000);
  assert.equal(kpi.deudaPesos, 20000);
  assert.equal(kpi.esperadoPesos, 15000);
  assert.equal(kpi.porCobrarPesos, 35000);
});

test("sin turnos → todo en cero", () => {
  const kpi = computeCobroKpi([]);
  assert.deepEqual(kpi, {
    cobradoPesos: 0,
    deudaPesos: 0,
    deudaCount: 0,
    esperadoPesos: 0,
    porCobrarPesos: 0,
  });
});

// ─── montoRegistradoCents ───────────────────────────────────────────────────

test("montoRegistradoCents: sin cobro → null (no hay fila en `pago`)", () => {
  assert.equal(montoRegistradoCents({ estado: "cerrado", precio: 5000 }), null);
});

test("montoRegistradoCents: pagado sin monto (mock/legacy) cae al precio del turno", () => {
  assert.equal(
    montoRegistradoCents({ estado: "cerrado", precio: 5000, cobro: { estado: "pagado", ts: null } }),
    500_000,
  );
});

// ─── cobroOptimistaAlCerrar (espejo de transitionTurno) ─────────────────────

test("cierre con cobro explícito: respeta monto y 'quedó debiendo'", () => {
  const turno: TurnoCobroLike = { estado: "atendiendo", precio: 20000 };
  assert.deepEqual(cobroOptimistaAlCerrar(turno, { montoCents: 1_200_000, pagado: true }, NOW_ISO), {
    estado: "pagado",
    ts: NOW_ISO,
    montoCents: 1_200_000,
  });
  assert.deepEqual(cobroOptimistaAlCerrar(turno, { montoCents: 1_200_000, pagado: false }, NOW_ISO), {
    estado: "pendiente",
    ts: null,
    montoCents: 1_200_000,
  });
});

test("cierre SIN diálogo (rol sin canRegistrarCobro): efectivo PAGADO por el precio", () => {
  assert.deepEqual(cobroOptimistaAlCerrar({ estado: "atendiendo", precio: 20000 }, undefined, NOW_ISO), {
    estado: "pagado",
    ts: NOW_ISO,
    montoCents: 2_000_000,
  });
});

test("monto 0: el server no inserta `pago` ⇒ no hay cobro que mostrar", () => {
  assert.deepEqual(cobroOptimistaAlCerrar({ estado: "atendiendo", precio: 0 }, undefined, NOW_ISO), {
    estado: "pendiente",
    ts: null,
    montoCents: null,
  });
  assert.deepEqual(
    cobroOptimistaAlCerrar({ estado: "atendiendo", precio: 20000 }, { montoCents: 0, pagado: true }, NOW_ISO),
    { estado: "pendiente", ts: null, montoCents: null },
  );
});

test("turno que YA tenía pago: gana el existente (upsert ignoreDuplicates)", () => {
  const yaPago: TurnoCobroLike = {
    estado: "atendiendo",
    precio: 20000,
    cobro: { estado: "pagado", ts: "2026-07-25T10:00:00.000Z", montoCents: 700_000 },
  };
  assert.deepEqual(cobroOptimistaAlCerrar(yaPago, { montoCents: 2_000_000, pagado: true }, NOW_ISO), yaPago.cobro);
});

test("el cobro optimista es consistente con el KPI (cerrar con deuda no mueve 'Recaudado')", () => {
  const turno: TurnoCobroLike = { estado: "atendiendo", precio: 20000 };
  const cerrado: TurnoCobroLike = {
    ...turno,
    estado: "cerrado",
    cobro: cobroOptimistaAlCerrar(turno, { montoCents: 2_000_000, pagado: false }, NOW_ISO),
  };
  const kpi = computeCobroKpi([cerrado]);
  assert.equal(kpi.cobradoPesos, 0);
  assert.equal(kpi.deudaPesos, 20000);
});

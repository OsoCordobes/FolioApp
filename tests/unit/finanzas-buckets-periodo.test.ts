import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngresosPorDia,
  buildIngresosPorMes,
  computeRangeOverride,
  wallClockInTzToUtc,
  type PagoAgregable,
} from "../../lib/db/finanzas";

// Review /finanzas · H5+H8 — bucketización del chart por período.
//
// Escenario de falla original: getFinanzasDelMes bucketizaba TODOS los pagos
// por DÍA DEL MES (dayInTz) sobre un eje 1..diasDelMes del mes ancla, y el
// LineChart recortaba con `d <= diaActual`. Consecuencias reproducidas abajo:
//   · "Semana" a caballo de dos meses → los días del mes anterior caían en
//     buckets 27..31 y el filtro `d <= diaActual` (2, un lunes de agosto) los
//     borraba de la curva.
//   · "Año" corto (enero/febrero, rango <40 días → chart diario) → todo pago
//     cuyo día-del-mes fuera mayor al de hoy desaparecía del gráfico aunque
//     estuviera sumado en el KPI y en el CSV.
// El gráfico contradecía al número de arriba. Ahora el bucket es la FECHA REAL
// en la TZ de la org y el eje ES el período elegido.

const TZ = "America/Argentina/Cordoba"; // UTC-3 fijo (sin DST)

/** Umbral del fetcher: >40 días → serie mensual; si no, serie diaria. */
const LONG_RANGE_MS = 40 * 24 * 60 * 60_000;

function pagado(createdAt: string, pesos: number, pagadoTs?: string): PagoAgregable {
  return {
    estado: "PAGADO",
    pagado_ts: pagadoTs ?? createdAt,
    created_at: createdAt,
    monto_cents: pesos * 100,
  };
}

function pendiente(createdAt: string, pesos: number): PagoAgregable {
  // pago_consistency (M09): pagado_ts es NULL salvo estado = PAGADO.
  return { estado: "PENDIENTE", pagado_ts: null, created_at: createdAt, monto_cents: pesos * 100 };
}

const sumaSerie = (serie: Array<{ monto: number }>) => serie.reduce((s, p) => s + p.monto, 0);
const totalPagado = (pagos: PagoAgregable[]) =>
  pagos.filter((p) => p.estado === "PAGADO").reduce((s, p) => s + p.monto_cents, 0) / 100;

// ─── H5 · "Semana" a caballo de dos meses ──────────────────────────────────

test("semana que cruza de mes: los días del mes anterior siguen en la curva", () => {
  // 2026-08-02 es domingo → la semana ISO arranca el lunes 2026-07-27.
  const now = new Date("2026-08-02T15:00:00.000Z"); // 12:00 AR
  const r = computeRangeOverride("semana", TZ, now);
  assert.ok(r);
  assert.equal(r!.startUtc, "2026-07-27T03:00:00.000Z");

  const pagos = [
    pagado("2026-07-28T14:00:00.000Z", 30_000), // martes 28 de JULIO
    pagado("2026-07-31T14:00:00.000Z", 20_000), // viernes 31 de JULIO
    pagado("2026-08-01T14:00:00.000Z", 10_000), // sábado 1 de AGOSTO
  ];

  const serie = buildIngresosPorDia(pagos, {
    startUtc: r!.startUtc,
    endUtc: r!.endUtc,
    timeZone: TZ,
    now,
  });

  // Eje = lunes 27/7 .. domingo 2/8 (7 días reales, no 1..31 de agosto).
  assert.deepEqual(serie.map((d) => d.fecha), [
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
    "2026-07-31", "2026-08-01", "2026-08-02",
  ]);
  // Antes: 28/7 y 31/7 caían en buckets 28 y 31 y el filtro d<=2 los borraba.
  assert.equal(serie.find((d) => d.fecha === "2026-07-28")!.monto, 30_000);
  assert.equal(serie.find((d) => d.fecha === "2026-07-31")!.monto, 20_000);
  assert.equal(serie.find((d) => d.fecha === "2026-08-01")!.monto, 10_000);
  // El KPI cierra con la curva.
  assert.equal(sumaSerie(serie), totalPagado(pagos));
});

test("semana que cruza de mes: labels con día/mes para no confundir 1/8 con 1/7", () => {
  const now = new Date("2026-08-02T15:00:00.000Z");
  const r = computeRangeOverride("semana", TZ, now)!;
  const serie = buildIngresosPorDia([], { startUtc: r.startUtc, endUtc: r.endUtc, timeZone: TZ, now });
  assert.equal(serie[0].label, "27/7");
  assert.equal(serie[serie.length - 1].label, "2/8");
});

test("semana dentro de un solo mes: labels de día solo (sin ruido)", () => {
  // 2026-08-06 es jueves → semana 3/8..6/8.
  const now = new Date("2026-08-06T15:00:00.000Z");
  const r = computeRangeOverride("semana", TZ, now)!;
  const serie = buildIngresosPorDia([], { startUtc: r.startUtc, endUtc: r.endUtc, timeZone: TZ, now });
  assert.equal(serie[0].label, "3");
  assert.equal(serie[serie.length - 1].label, "6");
});

// ─── H8 · "Año" corto (rango diario) ───────────────────────────────────────

test("año corto: un cobro con día-del-mes mayor a hoy NO desaparece de la curva", () => {
  // 5 de febrero: el rango del año va del 1/1 al 6/2 → 36 días (<40) ⇒ el
  // fetcher usa la serie DIARIA. Antes, un pago del 20 de enero se bucketizaba
  // en el día 20 y el chart recortaba con d <= 5: se esfumaba.
  const now = new Date("2026-02-05T15:00:00.000Z");
  const r = computeRangeOverride("anio", TZ, now)!;
  const rangeMs = new Date(r.endUtc).getTime() - new Date(r.startUtc).getTime();
  assert.ok(rangeMs <= LONG_RANGE_MS, "el año a comienzos de febrero todavía es rango corto");

  const pagos = [
    pagado("2026-01-20T14:00:00.000Z", 45_000), // día-del-mes 20 > hoy (5)
    pagado("2026-02-03T14:00:00.000Z", 15_000),
  ];
  const serie = buildIngresosPorDia(pagos, {
    startUtc: r.startUtc, endUtc: r.endUtc, timeZone: TZ, now,
  });

  assert.equal(serie[0].fecha, "2026-01-01");
  assert.equal(serie[serie.length - 1].fecha, "2026-02-05");
  assert.equal(serie.find((d) => d.fecha === "2026-01-20")!.monto, 45_000);
  assert.equal(sumaSerie(serie), totalPagado(pagos));
});

// ─── Propiedad transversal: la curva cierra con el KPI en los 5 períodos ───

test("la suma de la serie == total del KPI en hoy/semana/mes/6m/año", () => {
  const now = new Date("2026-07-15T15:00:00.000Z"); // 12:00 AR del 15/7
  // Pagos repartidos por todo el semestre, incluidos días-del-mes > 15 (el
  // caso que el filtro viejo borraba) y una deuda vieja saldada.
  const pagos: PagoAgregable[] = [
    pagado("2026-02-27T14:00:00.000Z", 12_000),
    pagado("2026-03-31T14:00:00.000Z", 8_000),
    pagado("2026-06-28T14:00:00.000Z", 25_000),
    pagado("2026-07-01T14:00:00.000Z", 5_000),
    pagado("2026-07-13T11:00:00.000Z", 7_000),
    pagado("2026-07-15T13:00:00.000Z", 9_000),
    // Deuda vieja (created en junio) saldada hoy: fuera del rango de "hoy"
    // por created_at, dentro de mes/6m/año.
    pagado("2026-06-02T14:00:00.000Z", 3_000, "2026-07-15T13:30:00.000Z"),
    pendiente("2026-07-10T14:00:00.000Z", 40_000), // no suma al chart ni al KPI
  ];

  const periodos = [
    ["hoy", computeRangeOverride("hoy", TZ, now)!],
    ["semana", computeRangeOverride("semana", TZ, now)!],
    ["mes", {
      startUtc: wallClockInTzToUtc(2026, 7, 1, 0, 0, 0, TZ).toISOString(),
      endUtc: wallClockInTzToUtc(2026, 8, 1, 0, 0, 0, TZ).toISOString(),
      label: "julio 2026",
    }],
    ["6m", computeRangeOverride("6m", TZ, now)!],
    ["anio", computeRangeOverride("anio", TZ, now)!],
  ] as const;

  for (const [nombre, rango] of periodos) {
    const startMs = new Date(rango.startUtc).getTime();
    const endMs = new Date(rango.endUtc).getTime();
    // Mismo filtro que la query (created_at ∈ rango) — el KPI se devenga así.
    const delPeriodo = pagos.filter((p) => {
      const t = new Date(p.created_at).getTime();
      return t >= startMs && t < endMs;
    });
    const esRangoLargo = endMs - startMs > LONG_RANGE_MS;
    const serie = esRangoLargo
      ? buildIngresosPorMes(delPeriodo, { startUtc: rango.startUtc, endUtc: rango.endUtc, timeZone: TZ })
      : buildIngresosPorDia(delPeriodo, { startUtc: rango.startUtc, endUtc: rango.endUtc, timeZone: TZ, now });

    assert.equal(
      sumaSerie(serie),
      totalPagado(delPeriodo),
      `el chart de "${nombre}" no cierra con el KPI`,
    );
  }
});

// ─── Eje: nunca días futuros, nunca montos descartados ─────────────────────

test("vista mensual a mitad de mes: el eje corta en HOY (sin cola de días vacíos)", () => {
  const now = new Date("2026-07-15T15:00:00.000Z");
  const serie = buildIngresosPorDia([], {
    startUtc: wallClockInTzToUtc(2026, 7, 1, 0, 0, 0, TZ).toISOString(),
    endUtc: wallClockInTzToUtc(2026, 8, 1, 0, 0, 0, TZ).toISOString(),
    timeZone: TZ,
    now,
  });
  assert.equal(serie.length, 15);
  assert.equal(serie[serie.length - 1].fecha, "2026-07-15");
});

test("mes ya cerrado: el eje cubre el mes completo", () => {
  const now = new Date("2026-09-10T15:00:00.000Z");
  const serie = buildIngresosPorDia([], {
    startUtc: wallClockInTzToUtc(2026, 7, 1, 0, 0, 0, TZ).toISOString(),
    endUtc: wallClockInTzToUtc(2026, 8, 1, 0, 0, 0, TZ).toISOString(),
    timeZone: TZ,
    now,
  });
  assert.equal(serie.length, 31);
  assert.equal(serie[30].fecha, "2026-07-31");
});

test("bucketización en TZ de la org: 02:00 UTC del 16 es todavía el 15 en AR", () => {
  const now = new Date("2026-07-16T15:00:00.000Z");
  const serie = buildIngresosPorDia([pagado("2026-07-16T02:00:00.000Z", 10_000)], {
    startUtc: wallClockInTzToUtc(2026, 7, 1, 0, 0, 0, TZ).toISOString(),
    endUtc: wallClockInTzToUtc(2026, 8, 1, 0, 0, 0, TZ).toISOString(),
    timeZone: TZ,
    now,
  });
  assert.equal(serie.find((d) => d.fecha === "2026-07-15")!.monto, 10_000);
  assert.equal(serie.find((d) => d.fecha === "2026-07-16")!.monto, 0);
});

test("pagos pendientes no entran a la curva (la deuda vive en el KPI Por cobrar)", () => {
  const now = new Date("2026-07-15T15:00:00.000Z");
  const serie = buildIngresosPorDia([pendiente("2026-07-10T14:00:00.000Z", 99_000)], {
    startUtc: wallClockInTzToUtc(2026, 7, 1, 0, 0, 0, TZ).toISOString(),
    endUtc: wallClockInTzToUtc(2026, 8, 1, 0, 0, 0, TZ).toISOString(),
    timeZone: TZ,
    now,
  });
  assert.equal(sumaSerie(serie), 0);
});

test("timestamp por delante de 'now' (skew de reloj) cae al último bucket, no se descarta", () => {
  const now = new Date("2026-07-15T15:00:00.000Z");
  const serie = buildIngresosPorDia([pagado("2026-07-16T01:00:00.000Z", 4_000)], {
    startUtc: wallClockInTzToUtc(2026, 7, 1, 0, 0, 0, TZ).toISOString(),
    endUtc: wallClockInTzToUtc(2026, 8, 1, 0, 0, 0, TZ).toISOString(),
    timeZone: TZ,
    now,
  });
  assert.equal(sumaSerie(serie), 4_000);
  assert.equal(serie[serie.length - 1].monto, 4_000);
});

test("período 'hoy': un solo bucket con todo el día", () => {
  const now = new Date("2026-07-15T15:00:00.000Z");
  const r = computeRangeOverride("hoy", TZ, now)!;
  const serie = buildIngresosPorDia(
    [pagado("2026-07-15T13:00:00.000Z", 6_000), pagado("2026-07-15T20:00:00.000Z", 4_000)],
    { startUtc: r.startUtc, endUtc: r.endUtc, timeZone: TZ, now },
  );
  assert.equal(serie.length, 1);
  assert.equal(serie[0].fecha, "2026-07-15");
  assert.equal(serie[0].monto, 10_000);
});

// ─── Serie mensual (6m / año largo) ────────────────────────────────────────

test("serie mensual: prellena los meses sin ingresos y cierra con el total", () => {
  const now = new Date("2026-07-15T15:00:00.000Z");
  const r = computeRangeOverride("6m", TZ, now)!; // feb..jul
  const pagos = [
    pagado("2026-02-27T14:00:00.000Z", 12_000),
    pagado("2026-07-14T14:00:00.000Z", 8_000),
  ];
  const serie = buildIngresosPorMes(pagos, { startUtc: r.startUtc, endUtc: r.endUtc, timeZone: TZ });
  assert.deepEqual(serie.map((s) => s.ym), [
    "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
  assert.equal(serie.find((s) => s.ym === "2026-03")!.monto, 0);
  assert.equal(sumaSerie(serie), totalPagado(pagos));
});

test("serie mensual: deuda vieja saldada en otro mes se devenga por created_at", () => {
  // created en marzo (dentro del rango), pagado_ts en enero (fuera): el monto
  // queda en marzo, que es el mes que el filtro de la query eligió.
  const now = new Date("2026-07-15T15:00:00.000Z");
  const r = computeRangeOverride("6m", TZ, now)!;
  const pagos = [pagado("2026-03-10T14:00:00.000Z", 5_000, "2026-01-05T14:00:00.000Z")];
  const serie = buildIngresosPorMes(pagos, { startUtc: r.startUtc, endUtc: r.endUtc, timeZone: TZ });
  assert.equal(serie.find((s) => s.ym === "2026-03")!.monto, 5_000);
  assert.equal(sumaSerie(serie), 5_000);
});

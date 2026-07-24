/**
 * Folio · tests · normalización de series del sparkline genérico (D3,
 * lib/instrumentos/components/planilla-core.ts).
 *
 * Fija la lógica PURA que sostiene el modo `normalizado` de <SerieEvolucion>
 * (métricas de rangos dispares — EVA 0–10 vs ODI 0–100 — sin aplastarse):
 *   - `escalasPorMetrica`: escala por métrica — dominio declarado del
 *     instrumento manda; sin dominio, min/max observados con el margen de
 *     escalaSerie; métrica sin datos degrada al default seguro.
 *   - `distribuirEtiquetas`: anti-colisión vertical de las anotaciones de
 *     "último valor" (separación mínima, clamping a los bordes, orden del
 *     input preservado).
 *
 * `node:test` no renderiza React — el `.tsx` consume estas funciones y se
 * verifica visualmente; acá se fija la geometría.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  distribuirEtiquetas,
  escalasPorMetrica,
  type MetricaSerie,
  type PuntoSerie,
} from "../../lib/instrumentos/components/planilla-core";

// ─── escalasPorMetrica ───────────────────────────────────────────────────────

const METRICAS_KINE: MetricaSerie[] = [
  { key: "eva", label: "Dolor EVA", color: "var(--red)", dominio: { min: 0, max: 10 } },
  { key: "odi", label: "ODI %", color: "var(--amber)", dominio: { min: 0, max: 100 } },
  { key: "borg", label: "Borg", color: "var(--slate)", dominio: { min: 6, max: 20 } },
];

const SERIE_KINE: PuntoSerie[] = [
  { fecha: "2026-06-01", valores: { eva: 8, odi: 46, borg: null } },
  { fecha: "2026-06-08", valores: { eva: 6, odi: 40, borg: 13 } },
  { fecha: "2026-06-15", valores: { eva: 4, odi: null, borg: 11 } },
];

test("escalasPorMetrica: el dominio declarado del instrumento manda", () => {
  const escalas = escalasPorMetrica(SERIE_KINE, METRICAS_KINE);
  assert.deepEqual(escalas.eva, { min: 0, max: 10 });
  assert.deepEqual(escalas.odi, { min: 0, max: 100 });
  assert.deepEqual(escalas.borg, { min: 6, max: 20 });
});

test("escalasPorMetrica: sin dominio usa min/max observados de ESA métrica", () => {
  const metricas: MetricaSerie[] = [
    { key: "peso", label: "Peso (kg)", color: "var(--accent)" },
    { key: "cintura", label: "Cintura (cm)", color: "var(--slate)" },
  ];
  const serie: PuntoSerie[] = [
    { fecha: "2026-06-01", valores: { peso: 82, cintura: 101 } },
    { fecha: "2026-06-08", valores: { peso: 79, cintura: 98 } },
    { fecha: "2026-06-15", valores: { peso: 68, cintura: 88 } },
  ];
  const escalas = escalasPorMetrica(serie, metricas);
  // Rango amplio (>=10): min/max reales — cada métrica ocupa TODO el alto.
  assert.deepEqual(escalas.peso, { min: 68, max: 82 });
  assert.deepEqual(escalas.cintura, { min: 88, max: 101 });
});

test("escalasPorMetrica: serie plana / rango chico se ensancha ±5 (no colapsa)", () => {
  const metricas: MetricaSerie[] = [{ key: "imc", label: "IMC", color: "var(--amber)" }];
  const serie: PuntoSerie[] = [
    { fecha: "2026-06-01", valores: { imc: 26 } },
    { fecha: "2026-06-08", valores: { imc: 25 } },
  ];
  assert.deepEqual(escalasPorMetrica(serie, metricas).imc, { min: 20, max: 31 });
});

test("escalasPorMetrica: métrica sin ningún dato → default seguro de escalaSerie", () => {
  const metricas: MetricaSerie[] = [{ key: "fc", label: "FC", color: "var(--slate)" }];
  const serie: PuntoSerie[] = [{ fecha: "2026-06-01", valores: { fc: null } }];
  assert.deepEqual(escalasPorMetrica(serie, metricas).fc, { min: 0, max: 10 });
});

test("escalasPorMetrica: dominio malformado (no finito) cae al observado", () => {
  const metricas: MetricaSerie[] = [
    { key: "x", label: "X", color: "var(--red)", dominio: { min: Number.NaN, max: 10 } },
  ];
  const serie: PuntoSerie[] = [
    { fecha: "2026-06-01", valores: { x: 40 } },
    { fecha: "2026-06-08", valores: { x: 70 } },
  ];
  assert.deepEqual(escalasPorMetrica(serie, metricas).x, { min: 40, max: 70 });
});

test("escalasPorMetrica: EVA no queda aplastada contra ODI (el bug que motiva el modo)", () => {
  // Con escala GLOBAL 0–100, una mejora de EVA 8→4 se movería el 4 % del alto.
  // Con escala propia 0–10, se mueve el 40 % — legible.
  const escalas = escalasPorMetrica(SERIE_KINE, METRICAS_KINE);
  const alto = 100; // px hipotéticos
  const y = (v: number, esc: { min: number; max: number }) =>
    ((v - esc.min) / (esc.max - esc.min)) * alto;
  const deltaEva = Math.abs(y(8, escalas.eva) - y(4, escalas.eva));
  assert.equal(deltaEva, 40);
});

// ─── distribuirEtiquetas ─────────────────────────────────────────────────────

test("distribuirEtiquetas: sin colisiones devuelve las y intactas", () => {
  assert.deepEqual(distribuirEtiquetas([10, 40, 90], 10, 0, 110), [10, 40, 90]);
});

test("distribuirEtiquetas: etiquetas pisadas se separan con la distancia mínima", () => {
  const res = distribuirEtiquetas([50, 52, 51], 10, 0, 110);
  const orden = [...res].sort((a, b) => a - b);
  assert.ok(orden[1] - orden[0] >= 10);
  assert.ok(orden[2] - orden[1] >= 10);
});

test("distribuirEtiquetas: preserva el orden del input (mapea por posición)", () => {
  // La 2.ª etiqueta (y=20) debe quedar ARRIBA de la 1.ª (y=80) tras ajustar.
  const res = distribuirEtiquetas([80, 20], 10, 0, 110);
  assert.ok(res[1] < res[0]);
});

test("distribuirEtiquetas: clampa al borde inferior empujando hacia arriba", () => {
  const res = distribuirEtiquetas([104, 106], 10, 0, 108);
  assert.ok(Math.max(...res) <= 108);
  const orden = [...res].sort((a, b) => a - b);
  assert.ok(orden[1] - orden[0] >= 10);
});

test("distribuirEtiquetas: clampa al borde superior re-apilando desde top", () => {
  const res = distribuirEtiquetas([2, 4], 10, 10, 110);
  assert.ok(Math.min(...res) >= 10);
  const orden = [...res].sort((a, b) => a - b);
  assert.ok(orden[1] - orden[0] >= 10);
});

test("distribuirEtiquetas: vacío y una sola etiqueta", () => {
  assert.deepEqual(distribuirEtiquetas([], 10, 0, 110), []);
  assert.deepEqual(distribuirEtiquetas([55], 10, 0, 110), [55]);
});

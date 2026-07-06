/**
 * Folio · tests · núcleo puro del renderer de planillas (C3,
 * lib/instrumentos/components/planilla-core.ts).
 *
 * Fija:
 *   - la deducción del modo de entrada por SHAPE del def (likert / binario /
 *     numérico / estructurado) contra todo el registry real;
 *   - las opciones efectivas por ítem;
 *   - el mapeo banda→tono por palabras-clave + desempate por posición, contra
 *     las bandas reales de cada instrumento;
 *   - la geometría de la serie (escala con/sin piso 0, aplanado de valores,
 *     puntos por métrica descartando null).
 *
 * `node:test` no renderiza React — por eso C3 aísla la lógica en este módulo
 * puro y la testea acá; el `.tsx` se verifica visualmente con Preview MCP.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { borg } from "../../lib/instrumentos/scoring/borg";
import { cssrs } from "../../lib/instrumentos/scoring/cssrs";
import { dass21 } from "../../lib/instrumentos/scoring/dass21";
import { gad7 } from "../../lib/instrumentos/scoring/gad7";
import { ndi } from "../../lib/instrumentos/scoring/ndi";
import { odi } from "../../lib/instrumentos/scoring/odi";
import { pcl5 } from "../../lib/instrumentos/scoring/pcl5";
import { phq9 } from "../../lib/instrumentos/scoring/phq9";
import { smartGoals } from "../../lib/instrumentos/scoring/smart-goals";
import { INSTRUMENTOS } from "../../lib/instrumentos/registry";
import {
  escalaSerie,
  etiquetaDeBanda,
  modoDeInstrumento,
  opcionesDeItem,
  puntosMetrica,
  toneDeBanda,
  valoresDeSerie,
  type MetricaSerie,
  type PuntoSerie,
} from "../../lib/instrumentos/components/planilla-core";

// ─── modoDeInstrumento ───────────────────────────────────────────────────────

test("modoDeInstrumento: likert para escalas 0..N multi-ítem", () => {
  for (const def of [phq9, gad7, dass21, pcl5, ndi, odi]) {
    assert.equal(modoDeInstrumento(def), "likert", `${def.id} debería ser likert`);
  }
});

test("modoDeInstrumento: binario para C-SSRS (2 opciones, N ítems)", () => {
  assert.equal(modoDeInstrumento(cssrs), "binario");
});

test("modoDeInstrumento: numerico para Borg (un solo ítem)", () => {
  assert.equal(modoDeInstrumento(borg), "numerico");
});

test("modoDeInstrumento: estructurado para SMART (sin opciones compartidas)", () => {
  assert.equal(modoDeInstrumento(smartGoals), "estructurado");
});

test("modoDeInstrumento: todo el registry cae en un modo conocido", () => {
  const modos = new Set(["likert", "binario", "numerico", "estructurado"]);
  for (const def of INSTRUMENTOS) {
    assert.ok(modos.has(modoDeInstrumento(def)), `${def.id} tiene modo inesperado`);
  }
});

// ─── opcionesDeItem ──────────────────────────────────────────────────────────

test("opcionesDeItem: usa las opciones del instrumento cuando el ítem no las sobreescribe", () => {
  assert.deepEqual(opcionesDeItem(phq9, 0), phq9.opciones);
  assert.equal(opcionesDeItem(phq9, 0).length, 4);
});

test("opcionesDeItem: instrumento sin opciones (SMART) → []", () => {
  assert.deepEqual(opcionesDeItem(smartGoals, 0), []);
});

test("opcionesDeItem: índice fuera de rango cae a las opciones del instrumento", () => {
  assert.deepEqual(opcionesDeItem(borg, 99), borg.opciones);
});

// ─── toneDeBanda ─────────────────────────────────────────────────────────────

test("toneDeBanda: bandas 'buenas' → good", () => {
  assert.equal(toneDeBanda("minima", phq9), "good");
  assert.equal(toneDeBanda("ninguna", ndi), "good");
  assert.equal(toneDeBanda("sin_riesgo", cssrs), "good");
  assert.equal(toneDeBanda("muy_ligero", borg), "good");
  assert.equal(toneDeBanda("ligero", borg), "good");
  assert.equal(toneDeBanda("bajo", cssrs), "good");
  assert.equal(toneDeBanda("completo", smartGoals), "good"); // SMART pleno
});

test("toneDeBanda: 'normal' cuenta como good (keyword)", () => {
  assert.equal(toneDeBanda("normal", dass21), "good");
});

test("toneDeBanda: bandas moderadas/parciales → warn", () => {
  assert.equal(toneDeBanda("moderada", phq9), "warn");
  assert.equal(toneDeBanda("moderado", cssrs), "warn");
  assert.equal(toneDeBanda("parcial", smartGoals), "warn");
  assert.equal(toneDeBanda("intenso", borg), "warn");
});

test("toneDeBanda: bandas severas/altas → bad", () => {
  assert.equal(toneDeBanda("severa", phq9), "bad");
  assert.equal(toneDeBanda("moderadamente_severa", phq9), "bad"); // contiene 'sever'
  assert.equal(toneDeBanda("alto", cssrs), "bad");
  assert.equal(toneDeBanda("extremadamente_severo", dass21), "bad");
  assert.equal(toneDeBanda("completa", ndi), "bad"); // discapacidad completa = peor
  assert.equal(toneDeBanda("maximo", borg), "bad");
});

test("toneDeBanda: severidad gana sobre warn cuando el id tiene ambas claves", () => {
  // "moderadamente_severa" incluye "moderad" (warn) y "sever" (bad) → bad.
  assert.equal(toneDeBanda("moderadamente_severa", phq9), "bad");
});

test("toneDeBanda: banda desconocida desempata por posición en def.bandas", () => {
  const fake = {
    ...phq9,
    bandas: [
      { id: "aaa", label: "A" },
      { id: "bbb", label: "B" },
      { id: "ccc", label: "C" },
    ],
  };
  assert.equal(toneDeBanda("aaa", fake), "good"); // primera → good
  assert.equal(toneDeBanda("bbb", fake), "warn"); // media → warn
  assert.equal(toneDeBanda("ccc", fake), "bad"); // última → bad
});

test("toneDeBanda: null / vacío / sin match ni def → neutral", () => {
  assert.equal(toneDeBanda(null), "neutral");
  assert.equal(toneDeBanda(undefined), "neutral");
  assert.equal(toneDeBanda(""), "neutral");
  assert.equal(toneDeBanda("xyz-desconocida"), "neutral");
});

test("toneDeBanda: cada banda de cada instrumento del registry mapea a un tono válido", () => {
  const tonos = new Set(["good", "neutral", "warn", "bad"]);
  for (const def of INSTRUMENTOS) {
    for (const b of def.bandas) {
      assert.ok(tonos.has(toneDeBanda(b.id, def)), `${def.id}/${b.id} tono inválido`);
    }
  }
});

// ─── etiquetaDeBanda ─────────────────────────────────────────────────────────

test("etiquetaDeBanda: devuelve el label del catálogo, o el id como fallback", () => {
  assert.equal(etiquetaDeBanda("minima", phq9), "Mínima");
  assert.equal(etiquetaDeBanda("severa", phq9), "Severa");
  assert.equal(etiquetaDeBanda("inexistente", phq9), "inexistente");
  assert.equal(etiquetaDeBanda("solo-id"), "solo-id"); // sin def
});

// ─── escalaSerie ─────────────────────────────────────────────────────────────

test("escalaSerie: pisoCero ancla min en 0 y da margen superior", () => {
  const { min, max } = escalaSerie([3, 8, 12], { pisoCero: true });
  assert.equal(min, 0);
  assert.equal(max, 14); // max(valores,10) + 2 = max(12,10)+2
});

test("escalaSerie: pisoCero con valores chicos igual usa techo mínimo 10", () => {
  const { min, max } = escalaSerie([1, 2], { pisoCero: true });
  assert.equal(min, 0);
  assert.equal(max, 12); // max(2,10)+2
});

test("escalaSerie: sin pisoCero usa min/max reales con margen mínimo de 10", () => {
  // Rango amplio: min/max reales.
  assert.deepEqual(escalaSerie([80, 140], { pisoCero: false }), { min: 80, max: 140 });
  // Rango chico (<10): se ensancha ±5.
  assert.deepEqual(escalaSerie([70, 72], { pisoCero: false }), { min: 65, max: 77 });
});

test("escalaSerie: sin valores → default seguro", () => {
  assert.deepEqual(escalaSerie([], { pisoCero: true }), { min: 0, max: 10 });
  assert.deepEqual(escalaSerie([], { pisoCero: false }), { min: 0, max: 10 });
});

// ─── valoresDeSerie / puntosMetrica ──────────────────────────────────────────

const METRICAS: MetricaSerie[] = [
  { key: "phq9", label: "PHQ-9", color: "var(--accent)" },
  { key: "gad7", label: "GAD-7", color: "var(--slate)" },
];

const SERIE: PuntoSerie[] = [
  { fecha: "2026-06-01", valores: { phq9: 12, gad7: null } },
  { fecha: "2026-06-08", valores: { phq9: 9, gad7: 7 } },
  { fecha: "2026-06-15", valores: { phq9: null, gad7: 4 } },
];

test("valoresDeSerie: aplana los valores no-null de las métricas dadas", () => {
  assert.deepEqual(valoresDeSerie(SERIE, METRICAS), [12, 9, 7, 4]);
});

test("valoresDeSerie: ignora métricas ausentes en los puntos", () => {
  const soloOtra: MetricaSerie[] = [{ key: "fc", label: "FC", color: "var(--slate)" }];
  assert.deepEqual(valoresDeSerie(SERIE, soloOtra), []);
});

test("puntosMetrica: devuelve (índice, valor) solo de puntos con dato", () => {
  assert.deepEqual(puntosMetrica(SERIE, "phq9"), [
    { i: 0, v: 12 },
    { i: 1, v: 9 },
  ]);
  assert.deepEqual(puntosMetrica(SERIE, "gad7"), [
    { i: 1, v: 7 },
    { i: 2, v: 4 },
  ]);
});

test("puntosMetrica: métrica sin ningún dato → []", () => {
  assert.deepEqual(puntosMetrica(SERIE, "inexistente"), []);
});

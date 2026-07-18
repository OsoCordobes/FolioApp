import assert from "node:assert/strict";
import test from "node:test";

import {
  computeImc,
  deriveNutriSeries,
  extractCintura,
  extractCircunferencias,
  extractObjetivosNutri,
  extractPeso,
  extractPliegues,
  extractTalla,
  nutricionToolDataSchema,
  parseNutricionToolData,
  resumenSesionNutricion,
} from "../../lib/especialidades/nutricion/schema";
import type { ToolHistorialEntry } from "../../lib/especialidades/types";

// ─── computeImc: fórmula + bandas OMS + contrato laxo ─────────────────────────

test("computeImc: peso/talla² con banda OMS orientativa (un decimal)", () => {
  // 70 kg / (1.75 m)² = 22.86 → 22.9, banda Normal.
  const normal = computeImc(70, 175);
  assert.deepEqual(normal, { valor: 22.9, banda: "Normal", tono: "green" });
  // 50 kg / (1.75 m)² = 16.3 → Bajo peso.
  assert.equal(computeImc(50, 175)?.banda, "Bajo peso");
  assert.equal(computeImc(50, 175)?.tono, "amber");
  // 85 kg / (1.75 m)² = 27.8 → Sobrepeso.
  assert.equal(computeImc(85, 175)?.banda, "Sobrepeso");
  // 100 kg / (1.75 m)² = 32.7 → Obesidad.
  assert.equal(computeImc(100, 175)?.banda, "Obesidad");
  assert.equal(computeImc(100, 175)?.tono, "red");
});

test("computeImc: bordes de banda (18.5 y 25 caen en la banda superior)", () => {
  // Ajuste de peso para caer exacto en 25.0 con talla 200 cm → 25 × 4 = 100 kg.
  const en25 = computeImc(100, 200);
  assert.equal(en25?.valor, 25);
  assert.equal(en25?.banda, "Sobrepeso"); // valor < 25 es Normal; 25 exacto ya no
  // Exacto 18.5: 18.5 × 4 = 74 kg con talla 200 cm.
  const en185 = computeImc(74, 200);
  assert.equal(en185?.valor, 18.5);
  assert.equal(en185?.banda, "Normal"); // valor < 18.5 es Bajo peso; 18.5 exacto ya no
});

test("computeImc: contrato laxo — falta un dato o fuera de rango → null", () => {
  assert.equal(computeImc(undefined, 175), null);
  assert.equal(computeImc(70, undefined), null);
  assert.equal(computeImc(null, null), null);
  assert.equal(computeImc("70", 175), null);
  assert.equal(computeImc(NaN, 175), null);
  // Talla absurda (1 cm) fuera del rango plausible → null (no un IMC gigante).
  assert.equal(computeImc(70, 1), null);
  // Peso fuera de rango → null.
  assert.equal(computeImc(9000, 175), null);
});

// ─── Extractores laxos ────────────────────────────────────────────────────────

test("extractPeso/extractTalla: dentro de rango o null", () => {
  assert.equal(extractPeso({ peso: 72.5 }), 72.5);
  assert.equal(extractPeso({ peso: 0 }), null); // < PESO_KG_MIN
  assert.equal(extractPeso({ peso: 600 }), null); // > PESO_KG_MAX
  assert.equal(extractPeso({}), null);
  assert.equal(extractPeso(null), null);
  assert.equal(extractPeso("garbage"), null);
  assert.equal(extractTalla({ talla: 172 }), 172);
  assert.equal(extractTalla({ talla: 10 }), null); // < TALLA_CM_MIN
  assert.equal(extractTalla({ talla: 300 }), null); // > TALLA_CM_MAX
});

test("extractCircunferencias/extractPliegues: valida item a item, descarta lo inválido", () => {
  const circ = extractCircunferencias({
    circunferencias: [
      { sitio: "cintura", cm: 84 },
      { sitio: "invalido", cm: 90 }, // sitio fuera del enum → descarta
      { sitio: "cadera", cm: 5000 }, // fuera de rango → descarta
      "basura",
      { sitio: "cadera", cm: 100 },
    ],
  });
  assert.deepEqual(circ, [
    { sitio: "cintura", cm: 84 },
    { sitio: "cadera", cm: 100 },
  ]);
  assert.deepEqual(extractCircunferencias(null), []);
  assert.deepEqual(extractCircunferencias({ circunferencias: "no-array" }), []);

  const pliegues = extractPliegues({
    pliegues: [
      { sitio: "tricipital", mm: 14 },
      { sitio: "tricipital", mm: 200 }, // fuera de rango
      { sitio: "codo", mm: 10 }, // sitio inválido
    ],
  });
  assert.deepEqual(pliegues, [{ sitio: "tricipital", mm: 14 }]);
});

test("extractCintura: devuelve el cm de cintura o null", () => {
  assert.equal(
    extractCintura({ circunferencias: [{ sitio: "cadera", cm: 100 }, { sitio: "cintura", cm: 84 }] }),
    84,
  );
  assert.equal(extractCintura({ circunferencias: [{ sitio: "cadera", cm: 100 }] }), null);
  assert.equal(extractCintura(null), null);
});

test("extractObjetivosNutri: valida item a item", () => {
  const out = extractObjetivosNutri({
    objetivos: [
      { texto: "Bajar 4 kg", estado: "en_curso" },
      { texto: "", estado: "logrado" }, // texto vacío → descarta
      { texto: "Sin estado" }, // falta estado → descarta
      { texto: "Estado inválido", estado: "cancelado" }, // estado fuera del enum
    ],
  });
  assert.deepEqual(out, [{ texto: "Bajar 4 kg", estado: "en_curso" }]);
});

// ─── deriveNutriSeries: orden ASC + arrastre de talla + IMC derivado ──────────

function sesion(fecha: string, toolData: unknown): ToolHistorialEntry {
  return { fecha, toolData };
}

test("deriveNutriSeries: ASC por fecha, IMC derivado, cintura extraída", () => {
  // Historial DESC (contrato del slot: más reciente primero).
  const historial: ToolHistorialEntry[] = [
    sesion("2026-06-15", { v: 1, peso: 76, talla: 172, circunferencias: [{ sitio: "cintura", cm: 86 }] }),
    sesion("2026-06-01", { v: 1, peso: 80, talla: 172, circunferencias: [{ sitio: "cintura", cm: 90 }] }),
  ];
  const serie = deriveNutriSeries(historial);
  // Sale ASC (la más vieja primero).
  assert.equal(serie.length, 2);
  assert.equal(serie[0].fecha, "2026-06-01");
  assert.equal(serie[1].fecha, "2026-06-15");
  assert.equal(serie[0].peso, 80);
  assert.equal(serie[0].cintura, 90);
  // 80 / 1.72² = 27.0 (sobrepeso), 76 / 1.72² = 25.7.
  assert.equal(serie[0].imc, 27);
  assert.equal(serie[1].imc, 25.7);
});

test("deriveNutriSeries: arrastra la última talla conocida a sesiones que sólo pesan", () => {
  const historial: ToolHistorialEntry[] = [
    sesion("2026-06-15", { v: 1, peso: 78 }), // sin talla → usa la de 2026-06-01
    sesion("2026-06-01", { v: 1, peso: 80, talla: 172 }),
  ];
  const serie = deriveNutriSeries(historial);
  assert.equal(serie[0].fecha, "2026-06-01");
  assert.equal(serie[0].imc, 27); // 80 / 1.72²
  assert.equal(serie[1].fecha, "2026-06-15");
  // La talla de la primera sesión (172) se arrastra: 78 / 1.72² = 26.4.
  assert.equal(serie[1].imc, 26.4);
});

test("deriveNutriSeries: sin talla previa el IMC queda null; sesiones sin métrica se omiten", () => {
  const historial: ToolHistorialEntry[] = [
    sesion("2026-06-10", { v: 1, planAlimentario: "solo plan, sin métricas" }), // se omite
    sesion("2026-06-05", { v: 1, peso: 70 }), // sin talla previa → imc null
  ];
  const serie = deriveNutriSeries(historial);
  assert.equal(serie.length, 1);
  assert.equal(serie[0].fecha, "2026-06-05");
  assert.equal(serie[0].peso, 70);
  assert.equal(serie[0].imc, null);
});

test("deriveNutriSeries: toolData ajeno/corrupto no rompe la serie", () => {
  const historial: ToolHistorialEntry[] = [
    sesion("2026-06-09", { presionArterial: "120/80" }), // cardio
    sesion("2026-06-08", null),
    sesion("2026-06-07", "garbage"),
    sesion("2026-06-01", { v: 1, peso: 75, talla: 170 }),
  ];
  const serie = deriveNutriSeries(historial);
  assert.equal(serie.length, 1);
  assert.equal(serie[0].peso, 75);
});

test("deriveNutriSeries: historial vacío → serie vacía", () => {
  assert.deepEqual(deriveNutriSeries([]), []);
});

// ─── Schema .strict() + parse ─────────────────────────────────────────────────

test("nutricionToolDataSchema: acepta v1 completo y rechaza claves ajenas (.strict)", () => {
  const ok = nutricionToolDataSchema.safeParse({
    v: 1,
    peso: 78,
    talla: 172,
    circunferencias: [{ sitio: "cintura", cm: 88 }],
    pliegues: [{ sitio: "tricipital", mm: 14 }],
    planAlimentario: "Plan 1800 kcal",
    observaciones: "Buena adherencia",
    objetivos: [{ texto: "Bajar 4 kg", estado: "en_curso" }],
  });
  assert.equal(ok.success, true);
  // Clave desconocida top-level → rechaza (defensa cross-tool).
  assert.equal(nutricionToolDataSchema.safeParse({ v: 1, foo: "bar" }).success, false);
  // v distinto de 1 → rechaza.
  assert.equal(nutricionToolDataSchema.safeParse({ v: 2, peso: 70 }).success, false);
  // Sitio de circunferencia fuera del enum → rechaza (no stripea el item).
  assert.equal(
    nutricionToolDataSchema.safeParse({ v: 1, circunferencias: [{ sitio: "x", cm: 80 }] }).success,
    false,
  );
});

test("parseNutricionToolData: discrimina v1 → empty", () => {
  assert.equal(parseNutricionToolData({ v: 1, peso: 70 }).kind, "v1");
  assert.equal(parseNutricionToolData(null).kind, "empty");
  assert.equal(parseNutricionToolData({ presionArterial: "120/80" }).kind, "empty");
  // Un payload de kinesiología (v1 pero con claves ajenas) rechaza por .strict.
  assert.equal(parseNutricionToolData({ v: 1, ndi: [1, 2, 3] }).kind, "empty");
});

// ─── resumenSesionNutricion ───────────────────────────────────────────────────

test("resumenSesionNutricion: peso + IMC (misma sesión) + cintura; conteos y plan", () => {
  // 78 / 1.72² = 26.4.
  assert.equal(
    resumenSesionNutricion({ v: 1, peso: 78, talla: 172, circunferencias: [{ sitio: "cintura", cm: 88 }] }),
    "78 kg · IMC 26.4 · Cintura 88 cm",
  );
  // Sin cintura pero con otras circunferencias → conteo.
  assert.equal(
    resumenSesionNutricion({ v: 1, peso: 78, circunferencias: [{ sitio: "cadera", cm: 102 }] }),
    "78 kg · 1 circunferencia",
  );
  // Pliegues + objetivos.
  assert.equal(
    resumenSesionNutricion({
      v: 1,
      pliegues: [{ sitio: "tricipital", mm: 14 }, { sitio: "bicipital", mm: 8 }],
      objetivos: [{ texto: "Bajar 4 kg", estado: "en_curso" }],
    }),
    "2 pliegues · 1 objetivo",
  );
  // Solo plan → flag.
  assert.equal(resumenSesionNutricion({ v: 1, planAlimentario: "Dieta 1800 kcal" }), "Plan actualizado");
  // Vacío / desconocido → copy genérico.
  assert.equal(resumenSesionNutricion({ v: 1 }), "Sesión registrada");
  assert.equal(resumenSesionNutricion(null), "Sesión registrada");
  assert.equal(resumenSesionNutricion({ cualquier: "cosa" }), "Sesión registrada");
});

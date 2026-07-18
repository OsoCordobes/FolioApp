/**
 * Folio · tests · psicología · workflow de riesgo suicida / plan de crisis (C7).
 *
 * Cubre lo NUEVO de lib/especialidades/psicologia/schema.ts para C7:
 *   - deteccionRiesgo — el trigger PURO (PHQ-9 ítem 9 > 0 O registro.riesgo in
 *     {ideacion, plan}); parciales, shapes ajenos, ambos motivos.
 *   - psicologiaToolDataV2Schema — parse válido/parcial/inválido + .strict() del
 *     bloque crisisPlan (incl. la longitud exacta del C-SSRS).
 *   - parsePsicologiaToolData — discrimina v2/v1/vacío.
 *   - extractCrisisPlan / scoreCssrsCrisis / resumenCrisisPlan — extracción laxa,
 *     scoring del screener y resumen (solo enum/estado, nunca texto libre).
 *   - resumenSesionPsicologia — el plan de crisis viaja al resumen del historial
 *     (preserva la decisión documentada de que el riesgo se destaca).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CSSRS_ITEMS,
  CSSRS_ITEMS_LEN,
  cssrsBandaLabel,
  deteccionRiesgo,
  extractCrisisPlan,
  parsePsicologiaToolData,
  psicologiaToolDataSchema,
  psicologiaToolDataV2Schema,
  resumenCrisisPlan,
  resumenSesionPsicologia,
  scoreCssrsCrisis,
  PHQ9_LEN,
} from "../../lib/especialidades/psicologia/schema";

/** PHQ-9 (9 ítems 0–3) con el ítem 9 (índice 8) seteado a `item9`. */
function phq9ConItem9(item9: number): number[] {
  const out = Array<number>(PHQ9_LEN).fill(0);
  out[PHQ9_LEN - 1] = item9;
  return out;
}

/** 6 respuestas C-SSRS todas 0, con las posiciones `pos` (1-based) en 1. */
function cssrs(...pos: number[]): number[] {
  const out = Array<number>(CSSRS_ITEMS_LEN).fill(0);
  for (const p of pos) out[p - 1] = 1;
  return out;
}

// ─── deteccionRiesgo (el trigger) ────────────────────────────────────────────

test("deteccionRiesgo: PHQ-9 ítem 9 > 0 dispara (aun con escala incompleta)", () => {
  assert.deepEqual(deteccionRiesgo({ v: 2, phq9: phq9ConItem9(1) }), {
    activo: true,
    motivos: ["phq9_item9"],
  });
  // Parcial: solo el ítem 9 cargado (resto null) igual dispara — basta ese ítem.
  const parcial = Array<number | null>(PHQ9_LEN).fill(null);
  parcial[PHQ9_LEN - 1] = 2;
  assert.deepEqual(deteccionRiesgo({ v: 2, phq9: parcial }), {
    activo: true,
    motivos: ["phq9_item9"],
  });
});

test("deteccionRiesgo: ítem 9 == 0 NO dispara por PHQ-9", () => {
  assert.deepEqual(deteccionRiesgo({ v: 2, phq9: phq9ConItem9(0) }), {
    activo: false,
    motivos: [],
  });
});

test("deteccionRiesgo: registro.riesgo ideacion/plan dispara; sin_riesgo/ausente no", () => {
  assert.deepEqual(deteccionRiesgo({ v: 2, registro: { riesgo: "ideacion" } }), {
    activo: true,
    motivos: ["registro_riesgo"],
  });
  assert.deepEqual(deteccionRiesgo({ v: 2, registro: { riesgo: "plan" } }), {
    activo: true,
    motivos: ["registro_riesgo"],
  });
  assert.deepEqual(deteccionRiesgo({ v: 2, registro: { riesgo: "sin_riesgo" } }), {
    activo: false,
    motivos: [],
  });
  assert.deepEqual(deteccionRiesgo({ v: 2, registro: { animo: "deprimido" } }), {
    activo: false,
    motivos: [],
  });
});

test("deteccionRiesgo: ambos motivos coexisten, en orden PHQ-9 → registro", () => {
  assert.deepEqual(
    deteccionRiesgo({ v: 2, phq9: phq9ConItem9(3), registro: { riesgo: "plan" } }),
    { activo: true, motivos: ["phq9_item9", "registro_riesgo"] },
  );
});

test("deteccionRiesgo: shapes ajenos/vacíos → inactivo (nunca rompe)", () => {
  assert.deepEqual(deteccionRiesgo(null), { activo: false, motivos: [] });
  assert.deepEqual(deteccionRiesgo(undefined), { activo: false, motivos: [] });
  assert.deepEqual(deteccionRiesgo("x"), { activo: false, motivos: [] });
  assert.deepEqual(deteccionRiesgo({ v: 1, vertebras: [] }), { activo: false, motivos: [] });
  // phq9 no-array o ítem 9 no-entero no dispara.
  assert.deepEqual(deteccionRiesgo({ v: 2, phq9: "x" }), { activo: false, motivos: [] });
  assert.deepEqual(deteccionRiesgo({ v: 2, phq9: [0, 0, 0, 0, 0, 0, 0, 0, 1.5] }), {
    activo: false,
    motivos: [],
  });
});

// ─── Schema v2 · bloque crisisPlan ───────────────────────────────────────────

test("v2 schema: crisisPlan completo válido (C-SSRS + plan de seguridad)", () => {
  const data = {
    v: 2,
    phq9: phq9ConItem9(2),
    crisisPlan: {
      cssrs: cssrs(4, 5),
      accesoMedios: "Restricción de acceso acordada.",
      factoresProtectores: "Red de apoyo familiar.",
      planTexto: "Contactos de emergencia y estrategias de afrontamiento.",
    },
  };
  assert.equal(psicologiaToolDataV2Schema.safeParse(data).success, true);
});

test("v2 schema: crisisPlan parcial (solo plan, o solo screener) válido", () => {
  assert.equal(
    psicologiaToolDataV2Schema.safeParse({ v: 2, crisisPlan: { planTexto: "x" } }).success,
    true,
  );
  assert.equal(
    psicologiaToolDataV2Schema.safeParse({ v: 2, crisisPlan: { cssrs: cssrs() } }).success,
    true,
  );
  // {v:2} pelado y crisisPlan vacío también válidos (todo opcional).
  assert.equal(psicologiaToolDataV2Schema.safeParse({ v: 2 }).success, true);
  assert.equal(psicologiaToolDataV2Schema.safeParse({ v: 2, crisisPlan: {} }).success, true);
});

test("v2 schema: crisisPlan inválido rechaza (C-SSRS mal formado, clave ajena, v mala)", () => {
  // v1 no parsea contra el schema v2 (literal).
  assert.equal(psicologiaToolDataV2Schema.safeParse({ v: 1 }).success, false);
  // C-SSRS de longitud incorrecta (persiste SOLO completo, 6 ítems).
  assert.equal(
    psicologiaToolDataV2Schema.safeParse({ v: 2, crisisPlan: { cssrs: cssrs(1).slice(0, 5) } })
      .success,
    false,
  );
  assert.equal(
    psicologiaToolDataV2Schema.safeParse({ v: 2, crisisPlan: { cssrs: Array(6).fill(2) } }).success,
    false,
  );
  // .strict(): clave desconocida en crisisPlan RECHAZA.
  assert.equal(
    psicologiaToolDataV2Schema.safeParse({ v: 2, crisisPlan: { xxx: 1 } }).success,
    false,
  );
  // .strict(): clave desconocida a nivel raíz RECHAZA (garantía cross-tool).
  assert.equal(
    psicologiaToolDataV2Schema.safeParse({ v: 2, vertebras: [] }).success,
    false,
  );
});

test("v2 schema: los catálogos del C-SSRS tienen la longitud del instrumento", () => {
  assert.equal(CSSRS_ITEMS.length, CSSRS_ITEMS_LEN);
  assert.equal(CSSRS_ITEMS_LEN, 6);
});

// ─── parsePsicologiaToolData (discriminador v2/v1/vacío) ─────────────────────

test("parsePsicologiaToolData: discrimina v2, v1 y vacío", () => {
  assert.equal(parsePsicologiaToolData({ v: 2, crisisPlan: { planTexto: "x" } }).kind, "v2");
  assert.equal(parsePsicologiaToolData({ v: 1, phq9: phq9ConItem9(1) }).kind, "v1");
  assert.equal(parsePsicologiaToolData({ v: 1 }).kind, "v1");
  assert.equal(parsePsicologiaToolData({ v: 2 }).kind, "v2");
  assert.equal(parsePsicologiaToolData(null).kind, "empty");
  assert.equal(parsePsicologiaToolData({ v: 1, vertebras: [] }).kind, "empty");
  // v1 sigue exportado e intacto (sin migración de datos).
  assert.equal(psicologiaToolDataSchema.safeParse({ v: 1 }).success, true);
});

// ─── extractCrisisPlan / scoreCssrsCrisis / resumenCrisisPlan ────────────────

test("extractCrisisPlan: bloque válido se extrae; v1 y ajenos → null", () => {
  const cp = extractCrisisPlan({ v: 2, crisisPlan: { cssrs: cssrs(5), planTexto: "plan" } });
  assert.ok(cp);
  assert.deepEqual(cp?.cssrs, cssrs(5));
  assert.equal(cp?.planTexto, "plan");
  assert.equal(extractCrisisPlan({ v: 1, phq9: phq9ConItem9(1) }), null);
  assert.equal(extractCrisisPlan(null), null);
  // crisisPlan con shape inválido → null (el historial nunca rompe).
  assert.equal(extractCrisisPlan({ v: 2, crisisPlan: { cssrs: [9, 9] } }), null);
});

test("scoreCssrsCrisis: puntúa el screener con la def de la biblioteca (banda por mayor severidad)", () => {
  assert.equal(scoreCssrsCrisis(cssrs())?.banda, "sin_riesgo");
  assert.equal(scoreCssrsCrisis(cssrs(1))?.banda, "bajo");
  assert.equal(scoreCssrsCrisis(cssrs(3))?.banda, "moderado");
  assert.equal(scoreCssrsCrisis(cssrs(5))?.banda, "alto");
  // La más severa gana.
  assert.equal(scoreCssrsCrisis(cssrs(1, 2, 6))?.banda, "alto");
  // Contrato laxo: incompleto/inválido → null.
  assert.equal(scoreCssrsCrisis(undefined), null);
  assert.equal(scoreCssrsCrisis([0, 0, 0]), null);
});

test("resumenCrisisPlan: solo enum/estado, nunca texto libre", () => {
  assert.equal(
    resumenCrisisPlan({ cssrs: cssrs(5), planTexto: "contactos y estrategias" }),
    "C-SSRS alto · plan de seguridad",
  );
  assert.equal(resumenCrisisPlan({ cssrs: cssrs() }), "C-SSRS sin riesgo detectado");
  assert.equal(resumenCrisisPlan({ planTexto: "solo el plan" }), "plan de seguridad");
  assert.equal(resumenCrisisPlan({ accesoMedios: "restricción" }), "plan de seguridad");
  assert.equal(resumenCrisisPlan({}), null);
  assert.equal(resumenCrisisPlan(null), null);
  // El texto del plan NUNCA aparece literal en el resumen.
  const r = resumenCrisisPlan({ cssrs: cssrs(4), planTexto: "SECRETO CLÍNICO" });
  assert.ok(r && !r.includes("SECRETO"));
});

test("cssrsBandaLabel: etiqueta es-AR en minúscula", () => {
  assert.equal(cssrsBandaLabel("alto"), "alto");
  assert.equal(cssrsBandaLabel("sin_riesgo"), "sin riesgo detectado");
  // Banda desconocida degrada al id (nunca rompe).
  assert.equal(cssrsBandaLabel("inventada"), "inventada");
});

// ─── resumenSesionPsicologia: el plan de crisis viaja al resumen (C7) ────────

test("resumenSesion (v2): el plan de crisis se destaca junto a escalas/riesgo", () => {
  assert.equal(
    resumenSesionPsicologia({
      v: 2,
      phq9: phq9ConItem9(0), // total 0 → banda mínima; ítem 9 = 0 sin ideación
      registro: { riesgo: "plan" },
      crisisPlan: { cssrs: cssrs(4, 5), planTexto: "plan acordado" },
    }),
    "PHQ-9 0 (mínima) · riesgo: plan · C-SSRS alto · plan de seguridad",
  );
  // Solo el plan de crisis, sin escalas ni registro → "Registro de sesión · …".
  assert.equal(
    resumenSesionPsicologia({ v: 2, crisisPlan: { cssrs: cssrs(3) } }),
    "Registro de sesión · C-SSRS moderado",
  );
});

test("resumenSesion (v1): sigue funcionando sin crisisPlan (sin migración de datos)", () => {
  assert.equal(
    resumenSesionPsicologia({ v: 1, registro: { riesgo: "ideacion" } }),
    "Registro de sesión · riesgo: ideación",
  );
});

/**
 * Folio · tests · cómputo de score de saveRespuesta (lib/db/instrumentos.ts).
 *
 * saveRespuesta computa el snapshot { scoreTotal, banda } SERVER-SIDE con la def
 * canónica del registry (lib/instrumentos) antes de cifrar/persistir — nunca se
 * confía en un score del cliente. Ese cómputo vive en `computeScoreSnapshot`,
 * PURO (sin DB, sin crypto), y es lo que este test fija:
 *
 *   - id desconocido → validation (no se persiste sin scoring canónico);
 *   - respuestas completas → snapshot { total, banda } EXACTO de la def, para los
 *     distintos shapes de respuesta (Likert array, subescalas, single-number,
 *     boolean[], objeto estructurado);
 *   - respuestas incompletas/inválidas → snapshot { null, null } (borrador
 *     válido: la fila se guarda igual);
 *   - versión derivada del sufijo `.vN` del id.
 *
 * No toca la DB ni FOLIO_ENC_KEY: importar lib/db/instrumentos sólo arrastra el
 * registry puro (lib/crypto se resuelve pero sus getters son lazy).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  computeScoreSnapshot,
  parseVersionFromId,
} from "../../lib/db/instrumentos";

// ─── id desconocido ──────────────────────────────────────────────────────────

test("computeScoreSnapshot: id desconocido → validation", () => {
  const r = computeScoreSnapshot("no_existe.v9", [0, 0, 0]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "validation");
});

test("computeScoreSnapshot: id conocido con respuestas incompletas → { null, null }", () => {
  // PHQ-9 espera 9 enteros; con 3 la def devuelve null → snapshot en null, pero
  // el verdict es ok (borrador válido, se puede persistir).
  const r = computeScoreSnapshot("phq9.v1", [1, 2, 3]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.snapshot.scoreTotal, null);
    assert.equal(r.snapshot.banda, null);
    assert.equal(r.version, 1);
  }
});

// ─── PHQ-9 (Likert array, total = suma) ──────────────────────────────────────

test("computeScoreSnapshot: PHQ-9 completo → total y banda de la def", () => {
  // 9 ítems todos en 1 → total 9 → banda 'leve' (5-9). Ítem 9 (idx 8) = 1 > 0
  // emite flag, pero el snapshot sólo persiste total + banda.
  const r = computeScoreSnapshot("phq9.v1", [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.snapshot.scoreTotal, 9);
    assert.equal(r.snapshot.banda, "leve");
  }
});

test("computeScoreSnapshot: PHQ-9 severo (todos 3 → 27 → severa)", () => {
  const r = computeScoreSnapshot("phq9.v1", Array<number>(9).fill(3));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.snapshot.scoreTotal, 27);
    assert.equal(r.snapshot.banda, "severa");
  }
});

test("computeScoreSnapshot: PHQ-9 mínimo (todos 0 → 0 → minima)", () => {
  const r = computeScoreSnapshot("phq9.v1", Array<number>(9).fill(0));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.snapshot.scoreTotal, 0);
    assert.equal(r.snapshot.banda, "minima");
  }
});

// ─── DASS-21 (subescalas; total global = suma de las 3 × 2) ───────────────────

test("computeScoreSnapshot: DASS-21 completo → total global (suma ×2) y banda máxima", () => {
  // Todos 0 → total 0, banda 'normal'.
  const r0 = computeScoreSnapshot("dass21.v1", Array<number>(21).fill(0));
  assert.equal(r0.ok, true);
  if (r0.ok) {
    assert.equal(r0.snapshot.scoreTotal, 0);
    assert.equal(r0.snapshot.banda, "normal");
  }
  // Todos 3 → cada subescala bruto 21 → ×2 = 42 → total global 126; todas las
  // subescalas extremas → banda global 'extremadamente_severo'.
  const rMax = computeScoreSnapshot("dass21.v1", Array<number>(21).fill(3));
  assert.equal(rMax.ok, true);
  if (rMax.ok) {
    assert.equal(rMax.snapshot.scoreTotal, 126);
    assert.equal(rMax.snapshot.banda, "extremadamente_severo");
  }
});

// ─── Borg (single number; total = el valor) ───────────────────────────────────

test("computeScoreSnapshot: Borg 6-20 → total = valor, banda por corte", () => {
  const r = computeScoreSnapshot("borg.v1", 13);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.snapshot.scoreTotal, 13);
    assert.equal(r.snapshot.banda, "moderado"); // 12-14
  }
  // Fuera de rango → def null → snapshot null (borrador).
  const rBad = computeScoreSnapshot("borg.v1", 99);
  assert.equal(rBad.ok, true);
  if (rBad.ok) assert.equal(rBad.snapshot.scoreTotal, null);
});

// ─── C-SSRS (boolean[]; total = cantidad de positivas, banda por severidad) ───

test("computeScoreSnapshot: C-SSRS → total = positivas, banda por ítem de mayor severidad", () => {
  // Todas negativas → 0 positivas, banda 'sin_riesgo'.
  const rNeg = computeScoreSnapshot("cssrs.v1", [false, false, false, false, false, false]);
  assert.equal(rNeg.ok, true);
  if (rNeg.ok) {
    assert.equal(rNeg.snapshot.scoreTotal, 0);
    assert.equal(rNeg.snapshot.banda, "sin_riesgo");
  }
  // Ítem 6 (conducta, idx 5) positivo → banda 'alto', 1 positiva.
  const rAlto = computeScoreSnapshot("cssrs.v1", [false, false, false, false, false, true]);
  assert.equal(rAlto.ok, true);
  if (rAlto.ok) {
    assert.equal(rAlto.snapshot.scoreTotal, 1);
    assert.equal(rAlto.snapshot.banda, "alto");
  }
});

// ─── SMART goals (objeto estructurado; total = criterios cumplidos) ──────────

test("computeScoreSnapshot: objetivos SMART → total = criterios cumplidos, banda por completitud", () => {
  const completo = computeScoreSnapshot("smart_goals.v1", {
    texto: "Caminar 30 min 3× por semana",
    especifico: true,
    medible: true,
    alcanzable: true,
    relevante: true,
    temporal: true,
    estado: "en_curso",
  });
  assert.equal(completo.ok, true);
  if (completo.ok) {
    assert.equal(completo.snapshot.scoreTotal, 5);
    assert.equal(completo.snapshot.banda, "completo");
  }
  // Objeto inválido (sin texto) → def null → snapshot null.
  const invalido = computeScoreSnapshot("smart_goals.v1", { texto: "", estado: "en_curso" });
  assert.equal(invalido.ok, true);
  if (invalido.ok) assert.equal(invalido.snapshot.scoreTotal, null);
});

// ─── parseVersionFromId ──────────────────────────────────────────────────────

test("parseVersionFromId: extrae la versión del sufijo .vN", () => {
  assert.equal(parseVersionFromId("dass21.v1"), 1);
  assert.equal(parseVersionFromId("phq9.v2"), 2);
  assert.equal(parseVersionFromId("smart_goals.v10"), 10);
  // Sin sufijo .vN → default defensivo 1.
  assert.equal(parseVersionFromId("legacy"), 1);
  assert.equal(parseVersionFromId("borg.v0"), 1); // v0 no es válido (>=1) → 1
});

test("computeScoreSnapshot: la versión sale del id de la DEF, no del arg", () => {
  // getInstrumento normaliza al id de la def (todas .v1 hoy) → version 1.
  const r = computeScoreSnapshot("gad7.v1", Array<number>(7).fill(0));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.version, 1);
});

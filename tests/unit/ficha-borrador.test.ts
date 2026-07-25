import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOSAVE_DEBOUNCE_MS,
  anioDeFecha,
  decidirAutosave,
  esBorradorSucio,
  type BorradorFicha,
  type DecisionAutosaveInput,
} from "../../lib/ficha/borrador";

const soapVacio = { subjetivo: "", objetivo: "", analisis: "", plan: "" };

function borrador(overrides: Partial<BorradorFicha> = {}): BorradorFicha {
  return { soap: { ...soapVacio }, toolValue: null, ...overrides };
}

// ─── esBorradorSucio ─────────────────────────────────────────────────────────

test("esBorradorSucio: idéntico al baseline → limpio", () => {
  const base = borrador({ soap: { ...soapVacio, subjetivo: "dolor lumbar" } });
  const actual = borrador({ soap: { ...soapVacio, subjetivo: "dolor lumbar" } });
  assert.equal(esBorradorSucio(actual, base), false);
});

test("esBorradorSucio: cualquier campo SOAP distinto → sucio", () => {
  const base = borrador();
  for (const campo of ["subjetivo", "objetivo", "analisis", "plan"] as const) {
    const actual = borrador({ soap: { ...soapVacio, [campo]: "x" } });
    assert.equal(esBorradorSucio(actual, base), true, `campo ${campo}`);
  }
});

test("esBorradorSucio: toolValue distinto (deep) → sucio", () => {
  const base = borrador({ toolValue: { v: 2, vertebras: [{ id: "C4", estado: "leve" }] } });
  const actual = borrador({ toolValue: { v: 2, vertebras: [{ id: "C4", estado: "severo" }] } });
  assert.equal(esBorradorSucio(actual, base), true);
});

test("esBorradorSucio: toolValue deep-igual (otra referencia) → limpio", () => {
  const base = borrador({ toolValue: { v: 2, vertebras: [{ id: "C4", estado: "leve" }] } });
  const actual = borrador({ toolValue: { v: 2, vertebras: [{ id: "C4", estado: "leve" }] } });
  assert.equal(esBorradorSucio(actual, base), false);
});

test("esBorradorSucio: null y undefined de toolValue colapsan (hidratación vs estado inicial)", () => {
  // El baseline se arma con `toolDraft ?? null`; la Tool puede emitir undefined.
  assert.equal(
    esBorradorSucio(borrador({ toolValue: undefined }), borrador({ toolValue: null })),
    false,
  );
});

test("esBorradorSucio: pasar de null a un toolValue real → sucio", () => {
  assert.equal(
    esBorradorSucio(borrador({ toolValue: { v: 1 } }), borrador({ toolValue: null })),
    true,
  );
});

test("esBorradorSucio: seed programático (value Y baseline con el MISMO objeto) → limpio", () => {
  // Contrato de onSeed (carry-forward quiro): el host setea toolValue y
  // baseline JUNTOS con el objeto sembrado — abrir la ficha NO deja un
  // borrador sucio (ni autosave, ni beforeunload, ni HC escrita sola).
  const sembrado = { v: 2, vista: "posterior", vertebras: [{ id: "C4", estado: "leve" }] };
  assert.equal(
    esBorradorSucio(borrador({ toolValue: sembrado }), borrador({ toolValue: sembrado })),
    false,
  );
});

test("esBorradorSucio: toolValue idéntico por referencia, aunque NO serialice → limpio", () => {
  // Sin el short-circuit por identidad, un valor circular caía en el fallback
  // no-serializable:${Math.random()} de stringifyTool → "siempre distinto" →
  // autosave infinito cada 10 s sin ningún cambio real.
  const circular: Record<string, unknown> = { v: 2 };
  circular.self = circular;
  assert.equal(
    esBorradorSucio(borrador({ toolValue: circular }), borrador({ toolValue: circular })),
    false,
  );
});

test("esBorradorSucio: no-serializables DISTINTOS por referencia → sucio (no perder cambios)", () => {
  const a: Record<string, unknown> = { v: 2 };
  a.self = a;
  const b: Record<string, unknown> = { v: 2 };
  b.self = b;
  assert.equal(esBorradorSucio(borrador({ toolValue: a }), borrador({ toolValue: b })), true);
});

// ─── decidirAutosave ─────────────────────────────────────────────────────────

/** Caso feliz: atención en curso, edición real, sucio, sin request ni error. */
function decision(overrides: Partial<DecisionAutosaveInput> = {}): DecisionAutosaveInput {
  return {
    sucio: true,
    guardando: false,
    hayTurno: true,
    hayError: false,
    modoTurno: "en_curso",
    huboInteraccion: true,
    ...overrides,
  };
}

test("decidirAutosave: turno EN CURSO + interacción real + sucio + sin request ni error → sí", () => {
  assert.equal(decidirAutosave(decision()), true);
});

test("decidirAutosave: sin turno ancla NUNCA autoguarda (borrador local)", () => {
  assert.equal(decidirAutosave(decision({ hayTurno: false, modoTurno: null })), false);
});

test("decidirAutosave: modo por_iniciar NUNCA autoguarda (una tecla a las 9:00 no inicia el turno de las 15:00)", () => {
  assert.equal(decidirAutosave(decision({ modoTurno: "por_iniciar" })), false);
});

test("decidirAutosave: modo retroactivo NUNCA autoguarda (un typo no se persiste solo sobre la sesión histórica)", () => {
  assert.equal(decidirAutosave(decision({ modoTurno: "retroactivo" })), false);
});

test("decidirAutosave: sin interacción REAL del profesional → no (el seed del carry-forward no cuenta)", () => {
  assert.equal(decidirAutosave(decision({ huboInteraccion: false })), false);
});

test("decidirAutosave: limpio o guardando → no", () => {
  assert.equal(decidirAutosave(decision({ sucio: false })), false);
  assert.equal(decidirAutosave(decision({ guardando: true })), false);
});

test("decidirAutosave: tras un error NO reintenta en loop (espera una edición nueva)", () => {
  assert.equal(decidirAutosave(decision({ hayError: true })), false);
});

test("AUTOSAVE_DEBOUNCE_MS: ~10 s tras la última tecla (contrato D1)", () => {
  assert.equal(AUTOSAVE_DEBOUNCE_MS, 10_000);
});

// ─── anioDeFecha ─────────────────────────────────────────────────────────────

test("anioDeFecha: deriva el año real de la sesión (fix del '2026' hardcodeado)", () => {
  assert.equal(anioDeFecha("2025-06-09"), "2025");
  assert.equal(anioDeFecha("2027-01-02"), "2027");
});

test("anioDeFecha: acepta ISO largo (timestamp) además de YYYY-MM-DD", () => {
  assert.equal(anioDeFecha("2026-07-24T14:30:00.000Z"), "2026");
});

test("anioDeFecha: inválida o vacía → '' (no mentir un año)", () => {
  assert.equal(anioDeFecha(""), "");
  assert.equal(anioDeFecha("—"), "");
  assert.equal(anioDeFecha("no-es-fecha"), "");
});

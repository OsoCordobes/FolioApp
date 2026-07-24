import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOSAVE_DEBOUNCE_MS,
  anioDeFecha,
  decidirAutosave,
  esBorradorSucio,
  type BorradorFicha,
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

// ─── decidirAutosave ─────────────────────────────────────────────────────────

test("decidirAutosave: solo con turno + sucio + sin guardado en vuelo + sin error", () => {
  assert.equal(
    decidirAutosave({ sucio: true, guardando: false, hayTurno: true, hayError: false }),
    true,
  );
});

test("decidirAutosave: sin turno ancla NUNCA autoguarda (borrador local)", () => {
  assert.equal(
    decidirAutosave({ sucio: true, guardando: false, hayTurno: false, hayError: false }),
    false,
  );
});

test("decidirAutosave: limpio o guardando → no", () => {
  assert.equal(
    decidirAutosave({ sucio: false, guardando: false, hayTurno: true, hayError: false }),
    false,
  );
  assert.equal(
    decidirAutosave({ sucio: true, guardando: true, hayTurno: true, hayError: false }),
    false,
  );
});

test("decidirAutosave: tras un error NO reintenta en loop (espera una edición nueva)", () => {
  assert.equal(
    decidirAutosave({ sucio: true, guardando: false, hayTurno: true, hayError: true }),
    false,
  );
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

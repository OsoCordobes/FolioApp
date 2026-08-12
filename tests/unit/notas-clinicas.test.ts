/**
 * Folio · validación del texto de una nota clínica (M96).
 *
 * La nota es append-only: una vez guardada no se edita ni se borra. Por eso la
 * validación se hace ANTES de escribir — después ya no hay vuelta atrás.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { NOTA_CLINICA_MAX, validarTextoNota } from "../../lib/ficha/nota-clinica";

test("una nota con contenido pasa, y se guarda sin espacios de borde", () => {
  const r = validarTextoNota("  Llamó por WhatsApp: dolor cede con hielo.  ");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.texto, "Llamó por WhatsApp: dolor cede con hielo.");
});

test("vacío o sólo espacios → no se guarda", () => {
  // En append-only, una nota vacía es basura permanente en la historia clínica.
  for (const v of ["", "   ", "\n\t  \n"]) {
    const r = validarTextoNota(v);
    assert.equal(r.ok, false, JSON.stringify(v));
    if (!r.ok) assert.equal(r.motivo, "vacia");
  }
});

test("el tope se mide sobre el texto YA trimmeado", () => {
  const justo = "x".repeat(NOTA_CLINICA_MAX);
  assert.equal(validarTextoNota(justo).ok, true);
  // Con espacios alrededor sigue entrando: el trim va antes que la medición.
  assert.equal(validarTextoNota(`  ${justo}  `).ok, true);
  assert.equal(validarTextoNota("x".repeat(NOTA_CLINICA_MAX + 1)).ok, false);
});

test("el error de largo dice cuánto se pasó", () => {
  const r = validarTextoNota("x".repeat(NOTA_CLINICA_MAX + 25));
  assert.equal(r.ok, false);
  // Un "texto demasiado largo" a secas obliga a adivinar cuánto recortar.
  if (!r.ok) assert.match(r.mensaje, new RegExp(String(NOTA_CLINICA_MAX + 25)));
});

test("un input que no es texto se rechaza sin explotar", () => {
  for (const v of [null, undefined, 42, {}, [], true]) {
    const r = validarTextoNota(v);
    assert.equal(r.ok, false, String(v));
  }
});

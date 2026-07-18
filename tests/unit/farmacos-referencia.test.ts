/**
 * Folio · tests · referencia de fármacos (lib/farmacos · R1).
 *
 * Invariantes del catálogo de monodrogas + normalización del renglón de
 * prescripción (texto libre + monodroga):
 *   - ids únicos y en formato slug,
 *   - cada `id` es el slug normalizado de su `nombre` (consistencia),
 *   - getMonodroga resuelve por id / undefined para desconocidos,
 *   - matchMonodroga es tolerante a acentos/mayúsculas y usa sinónimos,
 *   - normalizarRenglon: texto libre obligatorio, monodroga opcional, matchea el
 *     catálogo cuando puede y cae a texto libre cuando no (vademécum diferido),
 *   - valida longitudes y rechaza inputs inválidos con contrato laxo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buscarMonodrogas,
  getMonodroga,
  matchMonodroga,
  MAX_MONODROGA_LEN,
  MAX_RENGLON_LEN,
  MONODROGAS,
  monodrogaIds,
  normalizarNombre,
  normalizarRenglon,
} from "../../lib/farmacos";

// ─── Catálogo ─────────────────────────────────────────────────────────────────

test("catálogo: ids únicos y en formato slug", () => {
  const ids = monodrogaIds();
  assert.ok(ids.length >= 20, "el catálogo curado debería tener al menos 20 monodrogas");
  assert.equal(new Set(ids).size, ids.length, "hay ids duplicados");
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/, `id no es slug: ${id}`);
  }
});

test("catálogo: id derivado del nombre (slug-compatible) y nombre presente", () => {
  for (const m of MONODROGAS) {
    // El id es un slug estable derivado del nombre — su primer token debe
    // aparecer en el nombre normalizado (evita ids desalineados del nombre).
    // No se exige igualdad EXACTA: los compuestos usan un slug abreviado
    // (p. ej. "amoxicilina-clavulanico" para "Amoxicilina + ácido clavulánico").
    const primerToken = m.id.split("-")[0];
    assert.ok(
      normalizarNombre(m.nombre).includes(primerToken),
      `id ${m.id} desalineado del nombre "${m.nombre}"`,
    );
    assert.ok(m.nombre.length > 0, `${m.id} sin nombre`);
    // El nombre canónico matchea su propia entrada (autoconsistencia).
    assert.equal(matchMonodroga(m.nombre)?.id, m.id, `"${m.nombre}" no matchea su id ${m.id}`);
  }
});

test("getMonodroga: resuelve por id / undefined para desconocidos", () => {
  assert.equal(getMonodroga("ibuprofeno")?.nombre, "Ibuprofeno");
  assert.equal(getMonodroga("no-existe"), undefined);
  assert.equal(getMonodroga(""), undefined);
});

// ─── normalizarNombre ─────────────────────────────────────────────────────────

test("normalizarNombre: minúsculas, sin acentos, espacios colapsados", () => {
  assert.equal(normalizarNombre("  Ácido   Acetilsalicílico "), "acido acetilsalicilico");
  assert.equal(normalizarNombre("LOSARTÁN"), "losartan");
  assert.equal(normalizarNombre("Ibuprofeno"), "ibuprofeno");
});

// ─── matchMonodroga ───────────────────────────────────────────────────────────

test("matchMonodroga: tolerante a acentos y mayúsculas", () => {
  assert.equal(matchMonodroga("ibuprofeno")?.id, "ibuprofeno");
  assert.equal(matchMonodroga("IBUPROFENO")?.id, "ibuprofeno");
  assert.equal(matchMonodroga("losartan")?.id, "losartan");
  assert.equal(matchMonodroga("Losartán")?.id, "losartan");
});

test("matchMonodroga: resuelve por sinónimo", () => {
  assert.equal(matchMonodroga("aspirina")?.id, "acido-acetilsalicilico");
  assert.equal(matchMonodroga("AAS")?.id, "acido-acetilsalicilico");
  assert.equal(matchMonodroga("acetaminofeno")?.id, "paracetamol");
});

test("matchMonodroga: monodroga fuera del catálogo → undefined (no fuzzy)", () => {
  assert.equal(matchMonodroga("droga-inexistente-xyz"), undefined);
  assert.equal(matchMonodroga(""), undefined);
  // No hace match parcial: un prefijo no confirma selección.
  assert.equal(matchMonodroga("ibup"), undefined);
});

// ─── buscarMonodrogas ─────────────────────────────────────────────────────────

test("buscarMonodrogas: filtra por substring tolerante; query vacía → catálogo completo", () => {
  assert.equal(buscarMonodrogas("").length, MONODROGAS.length);
  const ibu = buscarMonodrogas("ibu");
  assert.ok(ibu.some((m) => m.id === "ibuprofeno"));
  // Por sinónimo.
  assert.ok(buscarMonodrogas("aspir").some((m) => m.id === "acido-acetilsalicilico"));
  assert.equal(buscarMonodrogas("no-hay-nada-asi").length, 0);
});

// ─── normalizarRenglon ────────────────────────────────────────────────────────

test("normalizarRenglon: texto libre obligatorio, monodroga ausente", () => {
  const r = normalizarRenglon({ texto: "  Ibuprofeno  400 mg,  cada  8 hs  " });
  assert.deepEqual(r, {
    texto: "Ibuprofeno 400 mg, cada 8 hs",
    monodrogaId: null,
    monodroga: null,
  });
});

test("normalizarRenglon: monodroga del catálogo → id + nombre canónico", () => {
  const r = normalizarRenglon({ texto: "1 comp cada 12 hs", monodroga: "losartán" });
  assert.equal(r?.monodrogaId, "losartan");
  assert.equal(r?.monodroga, "Losartán"); // nombre canónico del catálogo
  assert.equal(r?.texto, "1 comp cada 12 hs");
});

test("normalizarRenglon: monodroga fuera del catálogo → texto libre, id null", () => {
  const r = normalizarRenglon({ texto: "aplicar tópico", monodroga: "  Droga Nueva 2026 " });
  assert.equal(r?.monodrogaId, null);
  assert.equal(r?.monodroga, "Droga Nueva 2026"); // normalizada pero conservada
});

test("normalizarRenglon: monodroga vacía/null se trata como ausente", () => {
  for (const monodroga of ["", "   ", null, undefined]) {
    const r = normalizarRenglon({ texto: "algo", monodroga });
    assert.equal(r?.monodrogaId, null, `monodroga=${String(monodroga)}`);
    assert.equal(r?.monodroga, null, `monodroga=${String(monodroga)}`);
  }
});

test("normalizarRenglon: contrato laxo — inputs inválidos devuelven null", () => {
  assert.equal(normalizarRenglon(null), null);
  assert.equal(normalizarRenglon(undefined), null);
  assert.equal(normalizarRenglon("string"), null);
  assert.equal(normalizarRenglon([]), null);
  assert.equal(normalizarRenglon({}), null, "sin texto");
  assert.equal(normalizarRenglon({ texto: "" }), null, "texto vacío");
  assert.equal(normalizarRenglon({ texto: "   " }), null, "texto solo espacios");
  assert.equal(normalizarRenglon({ texto: 42 }), null, "texto no string");
  assert.equal(normalizarRenglon({ texto: "x".repeat(MAX_RENGLON_LEN + 1) }), null, "texto excede");
  assert.equal(
    normalizarRenglon({ texto: "ok", monodroga: "x".repeat(MAX_MONODROGA_LEN + 1) }),
    null,
    "monodroga excede",
  );
  assert.equal(normalizarRenglon({ texto: "ok", monodroga: 5 }), null, "monodroga no string");
});

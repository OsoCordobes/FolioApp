import assert from "node:assert/strict";
import test from "node:test";

import { ESPECIALIDAD_SLUGS } from "../../lib/especialidades/meta";
import {
  getEspecialidadServicios,
  getKnownTemplateServiceSignatures,
  getRubroTemplate,
  listRubros,
  TIPOS_CANONICOS_VALIDOS,
} from "../../lib/onboarding/templates";

const TIPOS_VALIDOS = new Set<string>(TIPOS_CANONICOS_VALIDOS);

test("especialidades: cada slug del registry tiene servicios template", () => {
  for (const slug of ESPECIALIDAD_SLUGS) {
    const servicios = getEspecialidadServicios(slug);
    assert.ok(servicios.length >= 3, `${slug}: esperaba >= 3 servicios, hay ${servicios.length}`);
    for (const s of servicios) {
      assert.ok(s.nombre.trim().length > 0, `${slug}: servicio sin nombre`);
      assert.ok(s.dur > 0, `${slug}/${s.nombre}: duración inválida`);
      assert.ok(s.precioCents > 0, `${slug}/${s.nombre}: precio inválido`);
    }
  }
});

test("especialidades: tipoCanonico ∈ enum tipo_servicio_canonico (M09)", () => {
  for (const slug of ESPECIALIDAD_SLUGS) {
    for (const s of getEspecialidadServicios(slug)) {
      assert.ok(
        TIPOS_VALIDOS.has(s.tipoCanonico),
        `${slug}/${s.nombre}: tipoCanonico "${s.tipoCanonico}" no está en el enum`,
      );
    }
  }
});

test("especialidades: quiropraxia reusa el set del rubro homónimo", () => {
  assert.deepEqual(
    getEspecialidadServicios("quiropraxia"),
    getRubroTemplate("quiropraxia").servicios,
  );
});

test("especialidades: contenido esperado de cardiología y psicología", () => {
  const cardio = getEspecialidadServicios("cardiologia").map((s) => s.nombre);
  assert.ok(cardio.some((n) => /cardiológica inicial/i.test(n)));
  assert.ok(cardio.includes("Electrocardiograma"));
  assert.ok(cardio.includes("Ergometría"));

  const psico = getEspecialidadServicios("psicologia");
  assert.ok(psico.some((s) => /primera entrevista/i.test(s.nombre)));
  const pareja = psico.find((s) => /pareja/i.test(s.nombre));
  assert.ok(pareja, "falta Sesión de pareja");
  assert.equal(pareja.dur, 80);
});

test("especialidades: fallback a quiropraxia para slugs desconocidos", () => {
  assert.deepEqual(getEspecialidadServicios("odontologia"), getEspecialidadServicios("quiropraxia"));
  assert.deepEqual(getEspecialidadServicios(null), getEspecialidadServicios("quiropraxia"));
  assert.deepEqual(getEspecialidadServicios(undefined), getEspecialidadServicios("quiropraxia"));
});

test("rubros: todos los tipoCanonico migrados al enum real (sin 'consulta'/'paquete' legacy)", () => {
  for (const { id } of listRubros()) {
    for (const s of getRubroTemplate(id).servicios) {
      assert.ok(
        TIPOS_VALIDOS.has(s.tipoCanonico),
        `rubro ${id}/${s.nombre}: tipoCanonico "${s.tipoCanonico}" no está en el enum`,
      );
    }
  }
});

test("signatures: incluye todos los templates de rubro y especialidad", () => {
  const sigs = getKnownTemplateServiceSignatures();
  for (const slug of ESPECIALIDAD_SLUGS) {
    const sig = getEspecialidadServicios(slug).map((s) => s.nombre).join("|");
    assert.ok(sigs.has(sig), `falta la firma de la especialidad ${slug}`);
  }
  for (const { id } of listRubros()) {
    const servicios = getRubroTemplate(id).servicios;
    if (servicios.length === 0) continue; // "otro" no aporta firma
    const sig = servicios.map((s) => s.nombre).join("|");
    assert.ok(sigs.has(sig), `falta la firma del rubro ${id}`);
  }
  // Una firma cualquiera editada a mano NO debe matchear.
  assert.ok(!sigs.has("Mi servicio custom"));
});

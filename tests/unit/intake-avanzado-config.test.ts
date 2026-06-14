/**
 * Folio · tests · intake avanzado por especialidad (Workstream 5, M60).
 *
 * Fija las invariantes del config del intake avanzado del registry:
 *   - cada especialidad tiene un config con campos + schema;
 *   - el schema es additive-friendly (opcionales, NO .strict → stripea claves
 *     desconocidas en vez de rechazar) — clave para que el writer
 *     (lib/db/paciente-intake.ts) y el alta best-effort no fallen ante data extra;
 *   - getIntakeAvanzadoConfig hace fallback a quiropraxia para slugs desconocidos;
 *   - cada key de `campos` existe en el shape del schema (coherencia form↔writer).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ESPECIALIDAD_SLUGS,
  ESPECIALIDADES_META,
  getIntakeAvanzadoConfig,
} from "../../lib/especialidades/meta";

test("cada especialidad expone un intakeAvanzado con campos y schema", () => {
  for (const slug of ESPECIALIDAD_SLUGS) {
    const config = ESPECIALIDADES_META[slug].intakeAvanzado;
    assert.ok(config, `${slug}: falta intakeAvanzado`);
    assert.ok(config.campos.length > 0, `${slug}: sin campos`);
    assert.ok(config.schema, `${slug}: sin schema`);
  }
});

test("getIntakeAvanzadoConfig: fallback a quiropraxia para slugs desconocidos", () => {
  assert.deepEqual(getIntakeAvanzadoConfig("cardiologia").campos, ESPECIALIDADES_META.cardiologia.intakeAvanzado.campos);
  assert.deepEqual(getIntakeAvanzadoConfig("odontologia").campos, ESPECIALIDADES_META.quiropraxia.intakeAvanzado.campos);
  assert.deepEqual(getIntakeAvanzadoConfig(null).campos, ESPECIALIDADES_META.quiropraxia.intakeAvanzado.campos);
  assert.deepEqual(getIntakeAvanzadoConfig(undefined).campos, ESPECIALIDADES_META.quiropraxia.intakeAvanzado.campos);
});

test("schema: objeto vacío {} es válido (la sección entera es opcional)", () => {
  for (const slug of ESPECIALIDAD_SLUGS) {
    assert.equal(getIntakeAvanzadoConfig(slug).schema.safeParse({}).success, true, `${slug}: {} debería parsear`);
  }
});

test("schema: additive-friendly — claves desconocidas se STRIPEAN, no rechazan", () => {
  for (const slug of ESPECIALIDAD_SLUGS) {
    const parsed = getIntakeAvanzadoConfig(slug).schema.safeParse({ claveAjena: "x", otra: 123 });
    assert.equal(parsed.success, true, `${slug}: claves desconocidas no deberían rechazar`);
    if (parsed.success) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(parsed.data, "claveAjena"),
        false,
        `${slug}: claveAjena debería stripearse`,
      );
    }
  }
});

test("cada key de campos existe en el shape del schema (coherencia form↔writer)", () => {
  for (const slug of ESPECIALIDAD_SLUGS) {
    const config = getIntakeAvanzadoConfig(slug);
    // El schema es un ZodObject; sus claves son las propiedades válidas.
    const shape = (config.schema as unknown as { shape: Record<string, unknown> }).shape;
    assert.ok(shape, `${slug}: el schema debería ser un ZodObject con .shape`);
    for (const campo of config.campos) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(shape, campo.key),
        `${slug}: el campo "${campo.key}" no está en el schema`,
      );
    }
    // select → opciones presentes y no vacías.
    for (const campo of config.campos) {
      if (campo.tipo === "select") {
        assert.ok((campo.opciones?.length ?? 0) > 0, `${slug}: el select "${campo.key}" no tiene opciones`);
      }
    }
  }
});

test("quiropraxia: tipoParto solo acepta las opciones declaradas", () => {
  const config = getIntakeAvanzadoConfig("quiropraxia");
  assert.equal(config.schema.safeParse({ tipoParto: "Cesárea" }).success, true);
  assert.equal(config.schema.safeParse({ tipoParto: "Otra cosa" }).success, false);
  assert.equal(config.schema.safeParse({ recibioQuiropraxiaAntes: true }).success, true);
  // Tipo equivocado (string donde va boolean) rechaza.
  assert.equal(config.schema.safeParse({ recibioQuiropraxiaAntes: "sí" }).success, false);
});

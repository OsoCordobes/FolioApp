/**
 * Folio · unit tests de la cobertura del paciente (lib/pacientes/cobertura.ts).
 *
 * Todo puro — sin DB ni crypto: validación zod (límites M89), normalización
 * previa al INSERT/UPDATE ("Particular"/vacío → null) y el display de la ficha
 * ("OSDE 210 · Nº 123456" / "Particular").
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  COBERTURA_NOMBRE_MAX,
  COBERTURA_NRO_AFILIADO_MAX,
  COBERTURA_PLAN_MAX,
  OBRAS_SOCIALES_AR,
  coberturaInputSchema,
  formatCobertura,
  normalizarCobertura,
} from "../../lib/pacientes/cobertura";

// ─── Validación zod ─────────────────────────────────────────────────────────

test("coberturaInputSchema: todos opcionales — objeto vacío es válido", () => {
  const r = coberturaInputSchema.safeParse({});
  assert.ok(r.success);
  assert.equal(r.data.coberturaNombre, undefined);
});

test("coberturaInputSchema: acepta valores dentro de los topes (120/40/40)", () => {
  const r = coberturaInputSchema.safeParse({
    coberturaNombre: "a".repeat(COBERTURA_NOMBRE_MAX),
    coberturaPlan: "b".repeat(COBERTURA_PLAN_MAX),
    coberturaNroAfiliado: "c".repeat(COBERTURA_NRO_AFILIADO_MAX),
  });
  assert.ok(r.success);
});

test("coberturaInputSchema: rechaza nombre > 120", () => {
  const r = coberturaInputSchema.safeParse({ coberturaNombre: "a".repeat(121) });
  assert.ok(!r.success);
});

test("coberturaInputSchema: rechaza plan > 40 y afiliado > 40", () => {
  assert.ok(!coberturaInputSchema.safeParse({ coberturaPlan: "b".repeat(41) }).success);
  assert.ok(!coberturaInputSchema.safeParse({ coberturaNroAfiliado: "c".repeat(41) }).success);
});

test("coberturaInputSchema: string vacío pasa (el writer lo normaliza a null)", () => {
  const r = coberturaInputSchema.safeParse({
    coberturaNombre: "",
    coberturaPlan: "",
    coberturaNroAfiliado: "",
  });
  assert.ok(r.success);
});

// ─── Normalización ──────────────────────────────────────────────────────────

test("normalizarCobertura: trim + vacío → null", () => {
  const c = normalizarCobertura({ nombre: "  OSDE  ", plan: "   ", nroAfiliado: "" });
  assert.equal(c.nombre, "OSDE");
  assert.equal(c.plan, null);
  assert.equal(c.nroAfiliado, null);
});

test('normalizarCobertura: "Particular" (cualquier case) → null — canónico M89', () => {
  assert.equal(normalizarCobertura({ nombre: "Particular" }).nombre, null);
  assert.equal(normalizarCobertura({ nombre: "PARTICULAR" }).nombre, null);
  assert.equal(normalizarCobertura({ nombre: "  particular " }).nombre, null);
});

test("normalizarCobertura: plan y nº afiliado son independientes del nombre", () => {
  // Una planilla puede traer solo el nº de afiliado — no se descarta.
  const c = normalizarCobertura({ nombre: "", plan: "210", nroAfiliado: "9988" });
  assert.equal(c.nombre, null);
  assert.equal(c.plan, "210");
  assert.equal(c.nroAfiliado, "9988");
});

test("normalizarCobertura: undefined/null tolerados", () => {
  const c = normalizarCobertura({});
  assert.deepEqual(c, { nombre: null, plan: null, nroAfiliado: null });
});

test('normalizarCobertura: un nombre que CONTIENE "particular" no se borra', () => {
  const c = normalizarCobertura({ nombre: "Mutual Particulares del Sur" });
  assert.equal(c.nombre, "Mutual Particulares del Sur");
});

// ─── Display ────────────────────────────────────────────────────────────────

test('formatCobertura: nombre + plan + afiliado → "OSDE 210 · Nº 123456"', () => {
  assert.equal(formatCobertura("OSDE", "210", "123456"), "OSDE 210 · Nº 123456");
});

test("formatCobertura: solo nombre", () => {
  assert.equal(formatCobertura("PAMI"), "PAMI");
  assert.equal(formatCobertura("PAMI", null, null), "PAMI");
});

test("formatCobertura: nombre + afiliado sin plan", () => {
  assert.equal(formatCobertura("IOMA", null, "77-11"), "IOMA · Nº 77-11");
});

test('formatCobertura: sin nombre → "Particular" (aunque haya plan/afiliado)', () => {
  assert.equal(formatCobertura(null), "Particular");
  assert.equal(formatCobertura(undefined), "Particular");
  assert.equal(formatCobertura("", "210", "1"), "Particular");
  assert.equal(formatCobertura("   "), "Particular");
});

// ─── Datalist ───────────────────────────────────────────────────────────────

test("OBRAS_SOCIALES_AR: incluye las más comunes y no tiene duplicados", () => {
  for (const esperada of ["OSDE", "Swiss Medical", "PAMI", "IOMA", "Avalian", "Particular"]) {
    assert.ok(OBRAS_SOCIALES_AR.includes(esperada), `falta ${esperada}`);
  }
  assert.equal(new Set(OBRAS_SOCIALES_AR).size, OBRAS_SOCIALES_AR.length);
});

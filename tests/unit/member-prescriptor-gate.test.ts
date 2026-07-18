/**
 * Folio · tests · gate + schema de datos prescriptores del member
 * (lib/db/members.ts → checkPrescriptorUpdateAllowed + prescriptorSchema — M78/R1).
 *
 * Regla de producto (R1): la identidad prescriptora (REFEPS/registro,
 * jurisdicción, especialidad prescriptora) la setea dirección (canManageTeam:
 * OWNER/DIRECTOR) O el propio profesional. Sólo los colegiados prescriben. A
 * diferencia de la especialidad clínica (M55) NO se gatea por tipo de org: un
 * profesional de un consultorio independiente también prescribe.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkPrescriptorUpdateAllowed,
  prescriptorSchema,
} from "../../lib/db/members";

const SELF = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

// ─── Gate de actor ────────────────────────────────────────────────────────────

test("OWNER y DIRECTOR (canManageTeam) editan el prescriptor de cualquier colegiado", () => {
  for (const role of ["OWNER", "DIRECTOR"] as const) {
    const verdict = checkPrescriptorUpdateAllowed({
      actorRole: role,
      actorEsColegiado: false, // DIRECTOR administrativo también gestiona equipo
      actorMemberId: SELF,
      targetMemberId: OTRO,
      targetEsColegiado: true,
    });
    assert.equal(verdict.ok, true, `${role} debería poder`);
  }
});

test("PROFESIONAL edita su PROPIO prescriptor (self)", () => {
  const verdict = checkPrescriptorUpdateAllowed({
    actorRole: "PROFESIONAL",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: SELF,
    targetEsColegiado: true,
  });
  assert.equal(verdict.ok, true);
});

test("PROFESIONAL NO edita el prescriptor de otro member → forbidden", () => {
  const verdict = checkPrescriptorUpdateAllowed({
    actorRole: "PROFESIONAL",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: OTRO,
    targetEsColegiado: true,
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "forbidden");
});

test("ASISTENTE/COORDINADOR no editan prescriptores ajenos → forbidden", () => {
  for (const role of ["ASISTENTE", "COORDINADOR"] as const) {
    const verdict = checkPrescriptorUpdateAllowed({
      actorRole: role,
      actorEsColegiado: false,
      actorMemberId: SELF,
      targetMemberId: OTRO,
      targetEsColegiado: true,
    });
    assert.equal(verdict.ok, false, `${role} no debería poder`);
    if (!verdict.ok) assert.equal(verdict.code, "forbidden");
  }
});

// ─── Gate de target ───────────────────────────────────────────────────────────

test("target NO colegiado → validation (el prescriptor es clínico), aun para OWNER o self", () => {
  const porOwner = checkPrescriptorUpdateAllowed({
    actorRole: "OWNER",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: OTRO,
    targetEsColegiado: false,
  });
  assert.equal(porOwner.ok, false);
  if (!porOwner.ok) assert.equal(porOwner.code, "validation");

  const porSelf = checkPrescriptorUpdateAllowed({
    actorRole: "ASISTENTE",
    actorEsColegiado: false,
    actorMemberId: SELF,
    targetMemberId: SELF,
    targetEsColegiado: false,
  });
  assert.equal(porSelf.ok, false);
  if (!porSelf.ok) assert.equal(porSelf.code, "validation");
});

// ─── No gatea por tipo de org (a diferencia de M55) ───────────────────────────

test("un colegiado de consultorio independiente edita su prescriptor (sin gate de org)", () => {
  // No hay parámetro orgTipo en el gate: el prescriptor aplica a todo colegiado.
  const verdict = checkPrescriptorUpdateAllowed({
    actorRole: "PROFESIONAL",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: SELF,
    targetEsColegiado: true,
  });
  assert.equal(verdict.ok, true);
});

// ─── Schema ───────────────────────────────────────────────────────────────────

test("prescriptorSchema: recorta, y vacío/whitespace → null (limpia el campo)", () => {
  const parsed = prescriptorSchema.parse({
    registroPrescriptor: "  REFEPS-12345  ",
    jurisdiccionMatricula: "   ",
    especialidadPrescriptora: "",
  });
  assert.equal(parsed.registroPrescriptor, "REFEPS-12345");
  assert.equal(parsed.jurisdiccionMatricula, null);
  assert.equal(parsed.especialidadPrescriptora, null);
});

test("prescriptorSchema: campos ausentes → null (todos opcionales)", () => {
  const parsed = prescriptorSchema.parse({});
  assert.deepEqual(parsed, {
    registroPrescriptor: null,
    jurisdiccionMatricula: null,
    especialidadPrescriptora: null,
  });
});

test("prescriptorSchema: rechaza longitudes que exceden los CHECK de M78", () => {
  assert.equal(
    prescriptorSchema.safeParse({ registroPrescriptor: "x".repeat(61) }).success,
    false,
    "registro >60",
  );
  assert.equal(
    prescriptorSchema.safeParse({ jurisdiccionMatricula: "x".repeat(81) }).success,
    false,
    "jurisdiccion >80",
  );
  assert.equal(
    prescriptorSchema.safeParse({ especialidadPrescriptora: "x".repeat(81) }).success,
    false,
    "especialidad >80",
  );
  // En el límite pasan.
  assert.equal(prescriptorSchema.safeParse({ registroPrescriptor: "x".repeat(60) }).success, true);
  assert.equal(prescriptorSchema.safeParse({ jurisdiccionMatricula: "x".repeat(80) }).success, true);
});

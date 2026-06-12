/**
 * Folio · tests · gate del cambio de especialidad por member
 * (lib/db/members.ts → checkEspecialidadUpdateAllowed + memberEspecialidadSchema — M55).
 *
 * Regla de producto (CLINICA-5): la especialidad de un member la setea
 * dirección (canManageTeam: OWNER/DIRECTOR) O el propio profesional. Solo
 * los colegiados tienen especialidad clínica. El slug se valida contra el
 * registry (null = vuelve a heredar organization.especialidad).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkEspecialidadUpdateAllowed,
  memberEspecialidadSchema,
} from "../../lib/db/members";

const SELF = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

// ─── Gates de actor ──────────────────────────────────────────────────────────

test("OWNER y DIRECTOR (canManageTeam) cambian la especialidad de cualquier colegiado", () => {
  for (const role of ["OWNER", "DIRECTOR"] as const) {
    const verdict = checkEspecialidadUpdateAllowed({
      actorRole: role,
      actorEsColegiado: false, // DIRECTOR administrativo también gestiona equipo
      actorMemberId: SELF,
      targetMemberId: OTRO,
      targetEsColegiado: true,
    });
    assert.equal(verdict.ok, true, `${role} debería poder`);
  }
});

test("PROFESIONAL cambia la PROPIA especialidad (self)", () => {
  const verdict = checkEspecialidadUpdateAllowed({
    actorRole: "PROFESIONAL",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: SELF,
    targetEsColegiado: true,
  });
  assert.equal(verdict.ok, true);
});

test("PROFESIONAL NO cambia la especialidad de otro member → forbidden", () => {
  const verdict = checkEspecialidadUpdateAllowed({
    actorRole: "PROFESIONAL",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: OTRO,
    targetEsColegiado: true,
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "forbidden");
});

test("ASISTENTE/COORDINADOR no cambian especialidades ajenas → forbidden", () => {
  for (const role of ["ASISTENTE", "COORDINADOR"] as const) {
    const verdict = checkEspecialidadUpdateAllowed({
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

// ─── Gate de target ──────────────────────────────────────────────────────────

test("target NO colegiado → validation (la especialidad es clínica), aun para OWNER o self", () => {
  // OWNER sobre una secretaria.
  const porOwner = checkEspecialidadUpdateAllowed({
    actorRole: "OWNER",
    actorEsColegiado: true,
    actorMemberId: SELF,
    targetMemberId: OTRO,
    targetEsColegiado: false,
  });
  assert.equal(porOwner.ok, false);
  if (!porOwner.ok) assert.equal(porOwner.code, "validation");

  // La propia asistente sobre sí misma.
  const porSelf = checkEspecialidadUpdateAllowed({
    actorRole: "ASISTENTE",
    actorEsColegiado: false,
    actorMemberId: SELF,
    targetMemberId: SELF,
    targetEsColegiado: false,
  });
  assert.equal(porSelf.ok, false);
  if (!porSelf.ok) assert.equal(porSelf.code, "validation");
});

// ─── Validación de slug ──────────────────────────────────────────────────────

test("memberEspecialidadSchema: slugs del registry y null pasan; el resto no", () => {
  for (const slug of ["quiropraxia", "cardiologia", "psicologia", null]) {
    assert.equal(memberEspecialidadSchema.safeParse(slug).success, true, `${slug} debería pasar`);
  }
  for (const invalido of ["odontologia", "", "QUIROPRAXIA", 42, undefined, {}]) {
    assert.equal(
      memberEspecialidadSchema.safeParse(invalido).success,
      false,
      `${String(invalido)} no debería pasar`,
    );
  }
});

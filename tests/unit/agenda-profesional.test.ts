import assert from "node:assert/strict";
import test from "node:test";

import {
  inicialesProfesional,
  nombreCortoProfesional,
  resolveAgendaProfesional,
  resolvePickerProfesional,
  type ProfesionalLite,
} from "../../lib/agenda/profesional";

const DRA_A: ProfesionalLite = { id: "aaaaaaaa-0000-0000-0000-000000000001", displayName: "Carla Gómez" };
const DR_B: ProfesionalLite = { id: "bbbbbbbb-0000-0000-0000-000000000002", displayName: "Martín Paz" };
const SESSION_MEMBER = "cccccccc-0000-0000-0000-000000000003";

// ─── resolveAgendaProfesional ───────────────────────────────────────────────

test("PROFESIONAL (sin actsAcrossProfessionals) ve SIEMPRE su propia agenda, sin selector", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: false,
    sessionMemberId: SESSION_MEMBER,
    profParam: null,
    profesionales: [DRA_A, DR_B],
  });
  assert.deepEqual(out, {
    selectorVisible: false,
    profesionalIdEfectivo: SESSION_MEMBER,
    mostrarAtribucion: false,
  });
});

test("PROFESIONAL: un ?prof= ajeno se ignora — el filtro sigue siendo su memberId", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: false,
    sessionMemberId: SESSION_MEMBER,
    profParam: DRA_A.id,
    profesionales: [DRA_A, DR_B],
  });
  assert.equal(out.profesionalIdEfectivo, SESSION_MEMBER);
  assert.equal(out.selectorVisible, false);
});

test("org Solo (1 colegiado): sin selector, sin filtro, sin atribución — render histórico", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: true,
    sessionMemberId: SESSION_MEMBER,
    profParam: null,
    profesionales: [DRA_A],
  });
  assert.deepEqual(out, {
    selectorVisible: false,
    profesionalIdEfectivo: null,
    mostrarAtribucion: false,
  });
});

test("org Solo: ?prof= no activa nada aunque apunte al único colegiado", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: true,
    sessionMemberId: SESSION_MEMBER,
    profParam: DRA_A.id,
    profesionales: [DRA_A],
  });
  assert.equal(out.selectorVisible, false);
  assert.equal(out.profesionalIdEfectivo, null);
});

test("org sin colegiados (booking muerto): comportamiento histórico, sin selector", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: true,
    sessionMemberId: SESSION_MEMBER,
    profParam: null,
    profesionales: [],
  });
  assert.deepEqual(out, {
    selectorVisible: false,
    profesionalIdEfectivo: null,
    mostrarAtribucion: false,
  });
});

test("clínica (>1 colegiado) + rol cross: selector visible, default 'Todos' con atribución", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: true,
    sessionMemberId: SESSION_MEMBER,
    profParam: null,
    profesionales: [DRA_A, DR_B],
  });
  assert.deepEqual(out, {
    selectorVisible: true,
    profesionalIdEfectivo: null,
    mostrarAtribucion: true,
  });
});

test("clínica: ?prof= válido filtra a ese profesional y apaga la atribución", () => {
  const out = resolveAgendaProfesional({
    actsAcrossProfessionals: true,
    sessionMemberId: SESSION_MEMBER,
    profParam: DR_B.id,
    profesionales: [DRA_A, DR_B],
  });
  assert.deepEqual(out, {
    selectorVisible: true,
    profesionalIdEfectivo: DR_B.id,
    mostrarAtribucion: false,
  });
});

test("clínica: ?prof= inválido (uuid ajeno / basura) cae a 'Todos'", () => {
  for (const malo of ["dddddddd-0000-0000-0000-000000000009", "no-un-uuid", ""]) {
    const out = resolveAgendaProfesional({
      actsAcrossProfessionals: true,
      sessionMemberId: SESSION_MEMBER,
      profParam: malo,
      profesionales: [DRA_A, DR_B],
    });
    assert.equal(out.profesionalIdEfectivo, null, `param "${malo}" debería caer a Todos`);
    assert.equal(out.selectorVisible, true);
    assert.equal(out.mostrarAtribucion, true);
  }
});

// ─── resolvePickerProfesional (CLINICA-3: default del picker en modales) ────

test("picker: org sin colegiados → oculto y sin default (decide el server)", () => {
  const out = resolvePickerProfesional({
    profesionales: [],
    sessionMemberId: SESSION_MEMBER,
    preferidoId: null,
  });
  assert.deepEqual(out, { pickerVisible: false, defaultProfesionalId: null });
});

test("picker: org Solo (1 colegiado) → sin picker, va ese colegiado", () => {
  const out = resolvePickerProfesional({
    profesionales: [DRA_A],
    sessionMemberId: SESSION_MEMBER, // sesión NO colegiada (no está en la lista)
    preferidoId: null,
  });
  assert.deepEqual(out, { pickerVisible: false, defaultProfesionalId: DRA_A.id });
});

test("picker: >1 colegiado → visible; default = sesión cuando es colegiada", () => {
  const out = resolvePickerProfesional({
    profesionales: [DRA_A, DR_B],
    sessionMemberId: DR_B.id,
    preferidoId: null,
  });
  assert.deepEqual(out, { pickerVisible: true, defaultProfesionalId: DR_B.id });
});

test("picker: el filtro activo (preferido válido) le gana a la sesión colegiada", () => {
  const out = resolvePickerProfesional({
    profesionales: [DRA_A, DR_B],
    sessionMemberId: DR_B.id,
    preferidoId: DRA_A.id,
  });
  assert.deepEqual(out, { pickerVisible: true, defaultProfesionalId: DRA_A.id });
});

test("picker: preferido inválido (no colegiado de la org) se ignora", () => {
  const out = resolvePickerProfesional({
    profesionales: [DRA_A, DR_B],
    sessionMemberId: DR_B.id,
    preferidoId: "dddddddd-0000-0000-0000-000000000009",
  });
  assert.equal(out.defaultProfesionalId, DR_B.id);
});

test("picker: sesión NO colegiada y sin preferido → primer colegiado", () => {
  const out = resolvePickerProfesional({
    profesionales: [DRA_A, DR_B],
    sessionMemberId: SESSION_MEMBER,
    preferidoId: null,
  });
  assert.deepEqual(out, { pickerVisible: true, defaultProfesionalId: DRA_A.id });
});

// ─── iniciales / nombre corto ───────────────────────────────────────────────

test("inicialesProfesional: nombre y apellido → 2 letras uppercase", () => {
  assert.equal(inicialesProfesional("Carla Gómez"), "CG");
  assert.equal(inicialesProfesional("martín paz"), "MP");
});

test("inicialesProfesional: con segundo nombre toma primera y última palabra", () => {
  assert.equal(inicialesProfesional("María del Pilar Suárez"), "MS");
});

test("inicialesProfesional: un solo término / vacío", () => {
  assert.equal(inicialesProfesional("Ana"), "A");
  assert.equal(inicialesProfesional("  "), "?");
  assert.equal(inicialesProfesional(""), "?");
});

test("inicialesProfesional: email como fallback de display name no rompe", () => {
  assert.equal(inicialesProfesional("dra.lopez@clinica.com"), "D");
});

test("nombreCortoProfesional: 'Nombre A.' y casos borde", () => {
  assert.equal(nombreCortoProfesional("Carla Gómez"), "Carla G.");
  assert.equal(nombreCortoProfesional("María del Pilar Suárez"), "María d.");
  assert.equal(nombreCortoProfesional("Ana"), "Ana");
  assert.equal(nombreCortoProfesional(""), "");
});

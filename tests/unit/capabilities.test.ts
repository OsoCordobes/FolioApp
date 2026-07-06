import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilitiesFor,
  matrixCell,
  PERMISSION_MATRIX_COLUMNS,
  PERMISSION_MATRIX_GROUPS,
  roleLabel,
  type Role,
} from "../../lib/auth/capabilities";

// ─── Clínica: acceso clínico (espejo de can_read_clinical) ──────────────────

test("OWNER ve clínica, finanzas totales y gestiona equipo", () => {
  const c = capabilitiesFor("OWNER", true);
  assert.equal(c.canReadClinical, true);
  assert.equal(c.canSeeFinanzasAll, true);
  assert.equal(c.canSeeFinanzas, true);
  assert.equal(c.canManageTeam, true);
  assert.equal(c.canSeeAudit, true);
  assert.equal(c.canCreatePacienteClinical, true);
});

test("PROFESIONAL ve su clínica y solo SUS finanzas, no gestiona equipo", () => {
  const c = capabilitiesFor("PROFESIONAL", true);
  assert.equal(c.canReadClinical, true);
  assert.equal(c.canSeeFinanzasAll, false);
  assert.equal(c.canSeeFinanzasOwn, true);
  assert.equal(c.canSeeFinanzas, true);
  assert.equal(c.canManageTeam, false);
  assert.equal(c.canSeeAudit, false);
  // Acotado a sí mismo → no actúa sobre otros profesionales.
  assert.equal(c.actsAcrossProfessionals, false);
});

test("DIRECTOR colegiado ve clínica; administrativo NO", () => {
  const colegiado = capabilitiesFor("DIRECTOR", true);
  const admin = capabilitiesFor("DIRECTOR", false);
  assert.equal(colegiado.canReadClinical, true);
  assert.equal(admin.canReadClinical, false);
  // Ambos gestionan equipo y ven finanzas totales.
  for (const c of [colegiado, admin]) {
    assert.equal(c.canManageTeam, true);
    assert.equal(c.canSeeFinanzasAll, true);
    assert.equal(c.actsAcrossProfessionals, true);
  }
});

// ─── Recepción / coordinación: sin clínica, sin panel de finanzas ───────────

test("ASISTENTE (secretaría): contacto sí, clínica/finanzas no", () => {
  const c = capabilitiesFor("ASISTENTE", false);
  assert.equal(c.canReadClinical, false);
  assert.equal(c.canCreatePacienteClinical, false);
  assert.equal(c.canManagePacienteContact, true); // PII / contacto
  assert.equal(c.canReadAdmin, true); // agenda
  assert.equal(c.canSeeFinanzas, false); // sin dashboard
  assert.equal(c.canRegistrarCobro, true); // cobra en el cierre de turno
  assert.equal(c.isReception, true);
  assert.equal(c.canManageTeam, false);
});

test("COORDINADOR: sin clínica ni finanzas, es recepción", () => {
  const c = capabilitiesFor("COORDINADOR", false);
  assert.equal(c.canReadClinical, false);
  assert.equal(c.canSeeFinanzas, false);
  assert.equal(c.isReception, true);
  assert.equal(c.canManageTeam, false);
});

// ─── Invariantes ────────────────────────────────────────────────────────────

test("solo OWNER/DIRECTOR gestionan equipo y ven auditoría", () => {
  const roles: Role[] = ["OWNER", "DIRECTOR", "PROFESIONAL", "COORDINADOR", "ASISTENTE"];
  for (const r of roles) {
    const c = capabilitiesFor(r, false);
    const isAdmin = r === "OWNER" || r === "DIRECTOR";
    assert.equal(c.canManageTeam, isAdmin, `canManageTeam ${r}`);
    assert.equal(c.canSeeAudit, isAdmin, `canSeeAudit ${r}`);
  }
});

test("ningún rol de recepción puede ver finanzas", () => {
  for (const r of ["ASISTENTE", "COORDINADOR"] as Role[]) {
    assert.equal(capabilitiesFor(r, false).canSeeFinanzas, false);
  }
});

// ─── Etiquetas ──────────────────────────────────────────────────────────────

test("roleLabel: DIRECTOR cambia según colegiado", () => {
  assert.equal(roleLabel("DIRECTOR", true), "Dirección médica");
  assert.equal(roleLabel("DIRECTOR", false), "Administración");
  assert.equal(roleLabel("PROFESIONAL", false), "Médico/a");
  assert.equal(roleLabel("ASISTENTE", false), "Secretaría");
  assert.equal(roleLabel("OWNER", true), "Dirección");
});

// ─── Matriz rol × capacidad (X4, vista) ─────────────────────────────────────

test("cada celda de la matriz coincide EXACTO con capabilitiesFor", () => {
  // La matriz no puede divergir del modelo: matrixCell(fila, col) debe ser
  // idéntico a leer el flag directo de capabilitiesFor(rol, colegiado).
  for (const group of PERMISSION_MATRIX_GROUPS) {
    for (const row of group.filas) {
      for (const col of PERMISSION_MATRIX_COLUMNS) {
        const caps = capabilitiesFor(col.role, col.esColegiado);
        assert.equal(
          matrixCell(row, col),
          caps[row.key],
          `${row.key} × ${col.key}`,
        );
      }
    }
  }
});

test("la matriz cubre las 6 columnas jerárquicas con DIRECTOR desdoblado", () => {
  const keys = PERMISSION_MATRIX_COLUMNS.map((c) => c.key);
  assert.deepEqual(keys, [
    "OWNER",
    "DIRECTOR_colegiado",
    "DIRECTOR_admin",
    "PROFESIONAL",
    "COORDINADOR",
    "ASISTENTE",
  ]);
  // Las dos columnas DIRECTOR difieren SOLO en acceso clínico (el punto de X4).
  const colegiado = PERMISSION_MATRIX_COLUMNS.find((c) => c.key === "DIRECTOR_colegiado")!;
  const admin = PERMISSION_MATRIX_COLUMNS.find((c) => c.key === "DIRECTOR_admin")!;
  const clinicaRow = PERMISSION_MATRIX_GROUPS.flatMap((g) => g.filas).find(
    (r) => r.key === "canReadClinical",
  )!;
  assert.equal(matrixCell(clinicaRow, colegiado), true);
  assert.equal(matrixCell(clinicaRow, admin), false);
});

test("las filas de la matriz no repiten capacidades", () => {
  const keys = PERMISSION_MATRIX_GROUPS.flatMap((g) => g.filas.map((f) => f.key));
  assert.equal(new Set(keys).size, keys.length, "capacidades duplicadas en la matriz");
});

test("OWNER tiene todas las capacidades listadas en la matriz", () => {
  const owner = PERMISSION_MATRIX_COLUMNS.find((c) => c.key === "OWNER")!;
  for (const row of PERMISSION_MATRIX_GROUPS.flatMap((g) => g.filas)) {
    // OWNER ve TODO salvo finanzas-propias (ese flag es específico de PROFESIONAL).
    if (row.key === "canSeeFinanzasOwn") {
      assert.equal(matrixCell(row, owner), false, "OWNER usa finanzas totales, no propias");
    } else {
      assert.equal(matrixCell(row, owner), true, `OWNER debería tener ${row.key}`);
    }
  }
});

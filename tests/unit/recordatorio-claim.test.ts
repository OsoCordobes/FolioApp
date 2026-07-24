import assert from "node:assert/strict";
import test from "node:test";

import {
  decideClaimRecordatorio,
  decideSkipRecordatorioOrgInterna,
} from "../../lib/db/recordatorios";

// Claim CAS del dispatcher de recordatorios (espejo de decidePedidoCas).
// `decideClaimRecordatorio` traduce el resultado del UPDATE guardado
// (filas afectadas + flag de error) a la decisión de control de flujo.

test("decideClaimRecordatorio: error de DB → db_error", () => {
  assert.equal(decideClaimRecordatorio(0, true), "db_error");
  assert.equal(decideClaimRecordatorio(1, true), "db_error");
});

test("decideClaimRecordatorio: 0 filas afectadas → skip (otra invocación claimeó o ya se envió)", () => {
  assert.equal(decideClaimRecordatorio(0, false), "skip");
});

test("decideClaimRecordatorio: exactamente 1 fila → claimed", () => {
  assert.equal(decideClaimRecordatorio(1, false), "claimed");
});

test("decideClaimRecordatorio: más de 1 fila → claimed (no debería pasar; id es PK)", () => {
  assert.equal(decideClaimRecordatorio(2, false), "claimed");
});

test("decideClaimRecordatorio: error gana sobre filas (no procede aunque haya filas)", () => {
  // Si hubo error, nunca confiamos en rowsAffected.
  assert.notEqual(decideClaimRecordatorio(1, true), "claimed");
});

// ─── Skip por org interna (demo) ─────────────────────────────────────────────
//
// Orgs internas (is_internal_account, M37) tienen pacientes MOCK con contactos
// ficticios: el dispatcher NUNCA debe enviarles WhatsApp/email. Solo `true`
// estricto skipea — null/undefined (select viejo sin la columna) no deben
// suprimir envíos de orgs reales.

test("decideSkipRecordatorioOrgInterna: true → skip", () => {
  assert.equal(decideSkipRecordatorioOrgInterna(true), true);
});

test("decideSkipRecordatorioOrgInterna: false/null/undefined → NO skip (org real envía)", () => {
  assert.equal(decideSkipRecordatorioOrgInterna(false), false);
  assert.equal(decideSkipRecordatorioOrgInterna(null), false);
  assert.equal(decideSkipRecordatorioOrgInterna(undefined), false);
});

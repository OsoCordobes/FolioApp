/**
 * Folio · tests · selección + sanitización de invitaciones del export ARCO
 * (lib/me/export-invitations.ts — Ley 25.326 art. 16, portabilidad).
 *
 * Fija dos contratos de compliance:
 *   1. NUNCA sale token_hash (ni otra columna fuera de la allow-list).
 *   2. Se exportan solo las invitaciones del titular (creadas o aceptadas).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvitationOrFilter,
  sanitizeInvitationsForExport,
  type RawInvitationRow,
} from "../../lib/me/export-invitations";

const USER = "00000000-0000-4000-8000-000000000001";
const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const OTHER_MEMBER = "99999999-9999-4999-8999-999999999999";
const OTHER_USER = "88888888-8888-4888-8888-888888888888";

function row(over: Partial<RawInvitationRow> & { id: string }): RawInvitationRow {
  return {
    organization_id: "org-1",
    email: "invitado@clinica.test",
    role: "PROFESIONAL",
    estado: "PENDIENTE",
    expires_at: "2026-07-01T00:00:00Z",
    accepted_at: null,
    created_at: "2026-06-01T00:00:00Z",
    invited_by_member_id: null,
    accepted_by_profile_id: null,
    // token_hash NO existe en RawInvitationRow — el SELECT del route no lo trae.
    ...over,
  };
}

test("buildInvitationOrFilter: incluye aceptadas y creadas cuando hay memberships", () => {
  const f = buildInvitationOrFilter(USER, [MEMBER_A, MEMBER_B]);
  assert.equal(
    f,
    `accepted_by_profile_id.eq.${USER},invited_by_member_id.in.(${MEMBER_A},${MEMBER_B})`,
  );
});

test("buildInvitationOrFilter: solo aceptadas cuando el titular no tiene memberships", () => {
  const f = buildInvitationOrFilter(USER, []);
  assert.equal(f, `accepted_by_profile_id.eq.${USER}`);
});

test("incluye invitación CREADA por el titular (invited_by ∈ sus members)", () => {
  const out = sanitizeInvitationsForExport(
    [row({ id: "inv-1", invited_by_member_id: MEMBER_A })],
    USER,
    [MEMBER_A, MEMBER_B],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].creada_por_el_titular, true);
  assert.equal(out[0].aceptada_por_el_titular, false);
});

test("incluye invitación ACEPTADA por el titular", () => {
  const out = sanitizeInvitationsForExport(
    [row({ id: "inv-2", estado: "ACEPTADA", accepted_by_profile_id: USER, accepted_at: "2026-06-02T00:00:00Z" })],
    USER,
    [MEMBER_A],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].aceptada_por_el_titular, true);
  assert.equal(out[0].creada_por_el_titular, false);
});

test("marca ambas relaciones si el titular se autoinvitó y aceptó", () => {
  const out = sanitizeInvitationsForExport(
    [row({ id: "inv-3", estado: "ACEPTADA", invited_by_member_id: MEMBER_A, accepted_by_profile_id: USER })],
    USER,
    [MEMBER_A],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].creada_por_el_titular, true);
  assert.equal(out[0].aceptada_por_el_titular, true);
});

test("excluye invitaciones ajenas (ni creadas ni aceptadas por el titular)", () => {
  const out = sanitizeInvitationsForExport(
    [
      row({ id: "ajena-1", invited_by_member_id: OTHER_MEMBER, accepted_by_profile_id: OTHER_USER }),
      row({ id: "ajena-2", invited_by_member_id: null, accepted_by_profile_id: null }),
    ],
    USER,
    [MEMBER_A, MEMBER_B],
  );
  assert.equal(out.length, 0);
});

test("la salida sanitizada NUNCA expone token_hash ni columnas de relación crudas", () => {
  const out = sanitizeInvitationsForExport(
    [row({ id: "inv-4", accepted_by_profile_id: USER })],
    USER,
    [],
  );
  const keys = Object.keys(out[0]).sort();
  assert.deepEqual(keys, [
    "accepted_at",
    "aceptada_por_el_titular",
    "creada_por_el_titular",
    "created_at",
    "email",
    "estado",
    "expires_at",
    "id",
    "organization_id",
    "role",
  ]);
  // Defensa explícita contra el secreto y los punteros internos.
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], "token_hash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], "invited_by_member_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], "accepted_by_profile_id"), false);
});

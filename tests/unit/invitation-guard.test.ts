/**
 * Folio · gate de invitación del alta de cuenta del invitado (F-AUTH).
 *
 * Regresión que esto guarda: `signUpForInvitationAction` creaba cuentas con
 * `admin.createUser({ email_confirm: true })` SIN mirar la invitación —
 * cualquiera con la URL de la action podía darse de alta auto-confirmado y
 * anular el "Confirm email" de producción.
 *
 * Las condiciones tienen que ser LAS MISMAS que accept_member_invitation
 * (M49:157-230): PENDIENTE, no vencida, lower(email) coincidente. Si divergen,
 * se crea una cuenta que después no puede aceptar la invitación.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  checkInvitationForSignup,
  hashInvitationToken,
  isWellFormedInvitationToken,
  type InvitationRowForSignup,
} from "../../app/(public)/invitacion/[token]/invitation-guard";

const AHORA = Date.parse("2026-08-11T12:00:00.000Z");
const EN_UNA_HORA = new Date(AHORA + 3_600_000).toISOString();
const HACE_UNA_HORA = new Date(AHORA - 3_600_000).toISOString();

function fila(over: Partial<InvitationRowForSignup> = {}): InvitationRowForSignup {
  return {
    email: "invitado@clinica.test",
    estado: "PENDIENTE",
    expires_at: EN_UNA_HORA,
    ...over,
  };
}

// ─── hash ───────────────────────────────────────────────────────────────────

test("hashInvitationToken replica encode(digest(token,'sha256'),'hex') de la RPC", () => {
  const token = "abcDEF-123_xyz";
  assert.equal(
    hashInvitationToken(token),
    createHash("sha256").update(token).digest("hex"),
  );
  // hex, 64 chars: el shape exacto de member_invitation.token_hash.
  assert.match(hashInvitationToken(token), /^[0-9a-f]{64}$/);
});

test("hashInvitationToken es case-sensitive (el token base64url lo es)", () => {
  assert.notEqual(hashInvitationToken("Token"), hashInvitationToken("token"));
});

// ─── forma del token ────────────────────────────────────────────────────────

test("isWellFormedInvitationToken acepta el token real (randomBytes(32).base64url)", () => {
  assert.equal(isWellFormedInvitationToken("a".repeat(43)), true);
  assert.equal(isWellFormedInvitationToken("aZ0_-".repeat(8) + "abc"), true);
});

test("isWellFormedInvitationToken corta basura antes de tocar la DB", () => {
  for (const malo of [
    "",
    "corto",
    "a".repeat(200),                 // token gigante
    "tiene espacios aca dentro!!",
    "punto.no.es.base64url.aaaaaaaaaaaaaaaaaaaaaaa",
    null,
    undefined,
    123,
    {},
  ]) {
    assert.equal(isWellFormedInvitationToken(malo), false, `deberia rechazar ${String(malo)}`);
  }
});

// ─── gate ───────────────────────────────────────────────────────────────────

test("invitación PENDIENTE, vigente y del mismo email → habilita el alta", () => {
  assert.deepEqual(
    checkInvitationForSignup(fila(), "invitado@clinica.test", AHORA),
    { ok: true },
  );
});

test("el email se compara case-insensitive y sin espacios (igual que lower(email) en la RPC)", () => {
  assert.deepEqual(
    checkInvitationForSignup(fila({ email: "Invitado@Clinica.TEST" }), "  invitado@clinica.test ", AHORA),
    { ok: true },
  );
});

test("token que no existe → no_existe (la fila vino null)", () => {
  assert.deepEqual(checkInvitationForSignup(null, "invitado@clinica.test", AHORA), {
    ok: false,
    reason: "no_existe",
  });
});

test("invitación ya aceptada o revocada → no habilita", () => {
  for (const estado of ["ACEPTADA", "REVOCADA", "EXPIRADA", "", null]) {
    const r = checkInvitationForSignup(fila({ estado }), "invitado@clinica.test", AHORA);
    assert.equal(r.ok, false, `estado ${String(estado)} no deberia habilitar`);
    if (!r.ok) assert.equal(r.reason, "no_pendiente");
  }
});

test("invitación vencida → no habilita (aunque siga PENDIENTE)", () => {
  assert.deepEqual(
    checkInvitationForSignup(fila({ expires_at: HACE_UNA_HORA }), "invitado@clinica.test", AHORA),
    { ok: false, reason: "vencida" },
  );
});

test("expires_at ilegible o ausente → fail-closed, no fail-open", () => {
  for (const exp of [null, "", "no soy una fecha"]) {
    const r = checkInvitationForSignup(fila({ expires_at: exp }), "invitado@clinica.test", AHORA);
    assert.equal(r.ok, false, `expires_at ${String(exp)} deberia denegar`);
    if (!r.ok) assert.equal(r.reason, "vencida");
  }
});

test("el borde de la expiración deniega (>=, no >)", () => {
  const justo = new Date(AHORA).toISOString();
  const r = checkInvitationForSignup(fila({ expires_at: justo }), "invitado@clinica.test", AHORA);
  assert.equal(r.ok, false);
});

test("email distinto al invitado → no habilita (es EL punto del gate)", () => {
  assert.deepEqual(
    checkInvitationForSignup(fila(), "otro@atacante.test", AHORA),
    { ok: false, reason: "otro_email" },
  );
});

test("fila con email nulo → no habilita (no se puede confirmar a quién invitaron)", () => {
  const r = checkInvitationForSignup(fila({ email: null }), "invitado@clinica.test", AHORA);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "otro_email");
});

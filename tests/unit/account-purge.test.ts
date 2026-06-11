/**
 * Account-purge (Ley 25.326 art. 16): el hard-delete IRREVERSIBLE de un profile
 * solo debe correr si la revocación previa de sus invitaciones aceptadas tuvo
 * éxito. Si falla y se borra igual, la FK ON DELETE SET NULL (M49) deja filas
 * ACEPTADA con acceptor NULL — estado incoherente sin reintento posible. Estos
 * tests fijan esa invariante en la decisión pura; si alguien vuelve a ignorar
 * el error de la revocación, acá se nota.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationRevokeAbortMessage,
  isSafeToHardDeleteProfile,
} from "../../lib/me/account-purge";

test("sin error en la revocación → seguro hard-deletear", () => {
  assert.equal(isSafeToHardDeleteProfile(null), true);
  assert.equal(isSafeToHardDeleteProfile(undefined), true);
});

test("error en la revocación → NO se hard-deletea (se aborta y reintenta)", () => {
  assert.equal(isSafeToHardDeleteProfile({ message: "deadlock detected" }), false);
  assert.equal(isSafeToHardDeleteProfile({ message: "" }), false);
  assert.equal(isSafeToHardDeleteProfile({}), false);
});

test("el mensaje de aborto incluye el detalle cuando lo hay", () => {
  assert.match(
    invitationRevokeAbortMessage({ message: "permission denied for table member_invitation" }),
    /permission denied for table member_invitation/,
  );
});

test("el mensaje de aborto es coherente sin detalle", () => {
  const generic = "No se pudo revocar las invitaciones aceptadas antes del borrado.";
  assert.equal(invitationRevokeAbortMessage(null), generic);
  assert.equal(invitationRevokeAbortMessage({ message: "   " }), generic);
  assert.equal(invitationRevokeAbortMessage({}), generic);
});

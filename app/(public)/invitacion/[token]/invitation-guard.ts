/**
 * Folio · gate de invitación para el alta de cuenta del invitado (F-AUTH).
 *
 * ─── Qué se rompía ─────────────────────────────────────────────────────────
 * `signUpForInvitationAction` creaba la cuenta con
 * `service.auth.admin.createUser({ email_confirm: true })` — service-role, o
 * sea salteando GoTrue — **sin mirar la invitación**. La action ni siquiera
 * recibía el token. Cualquiera que conociera su URL podía crear cuentas
 * auto-confirmadas y anular el toggle "Confirm email" que está ON en
 * producción. Y si el email ya existía, forzaba `email_confirm: true` sobre la
 * cuenta ajena **antes** de validar la password.
 *
 * ─── Qué hace este módulo ──────────────────────────────────────────────────
 * La lógica pura del gate, separada del I/O para poder testearla: hashear el
 * token igual que la DB, descartar tokens con forma inválida antes de tocar la
 * base, y decidir si una fila de `member_invitation` habilita el alta de ESE
 * email.
 *
 * Las condiciones son las MISMAS que `accept_member_invitation` (M49:157-230):
 * PENDIENTE, no vencida, y `lower(email)` coincidente. Si divergen, se puede
 * crear una cuenta que después no puede aceptar la invitación.
 *
 * El motivo del rechazo NO se le devuelve al usuario: "no existe", "expiró" y
 * "es para otro email" contestan todos SIGNUP_GENERIC_ERROR (anti-enumeración).
 * El `reason` es para logs y para los tests.
 */

import { createHash } from "node:crypto";

/**
 * El token crudo se genera con `randomBytes(32).toString("base64url")`
 * (lib/db/members.ts:566) → 43 chars base64url. Se acepta un rango en vez del
 * largo exacto para no romper si mañana cambia el tamaño, pero se corta
 * cualquier cosa que claramente no sea un token: evita un query por request con
 * basura y cierra la puerta a que un token gigante llegue a la DB.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** `true` si el token tiene forma de token de invitación. No dice si existe. */
export function isWellFormedInvitationToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/**
 * sha256 hex del token crudo — exactamente lo que guarda `token_hash` y lo que
 * recalcula la RPC con `encode(digest(p_token,'sha256'),'hex')` (M49:157).
 * El token crudo no se persiste ni se loguea en ningún lado.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Fila mínima de `member_invitation` que necesita el gate. */
export interface InvitationRowForSignup {
  email: string | null;
  estado: string | null;
  expires_at: string | null;
}

export type InvitationSignupGate =
  | { ok: true }
  | { ok: false; reason: "no_existe" | "no_pendiente" | "vencida" | "otro_email" };

/**
 * ¿Esta invitación habilita el alta de cuenta de `email`?
 *
 * @param row     fila de member_invitation encontrada por token_hash (o null).
 * @param email   email que el invitado está intentando registrar.
 * @param nowMs   inyectable para tests.
 */
export function checkInvitationForSignup(
  row: InvitationRowForSignup | null | undefined,
  email: string,
  nowMs: number = Date.now(),
): InvitationSignupGate {
  if (!row) return { ok: false, reason: "no_existe" };
  if (row.estado !== "PENDIENTE") return { ok: false, reason: "no_pendiente" };

  // Sin fecha de expiración legible, fail-closed: una fila que no podemos
  // fechar no habilita crear una cuenta.
  const expiresMs = row.expires_at ? Date.parse(row.expires_at) : NaN;
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return { ok: false, reason: "vencida" };
  }

  // Mismo criterio que la RPC: comparación case-insensitive sobre el email.
  const invited = (row.email ?? "").trim().toLowerCase();
  if (invited.length === 0 || invited !== email.trim().toLowerCase()) {
    return { ok: false, reason: "otro_email" };
  }

  return { ok: true };
}

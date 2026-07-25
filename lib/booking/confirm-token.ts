/**
 * Folio · token HMAC stateless de confirmación 1-click de turno (F7b · M90).
 *
 * El email de recordatorio 24h trae links "Confirmo mi turno" / "No puedo ir"
 * a `/t/<token>`. El token es STATELESS (sin tabla): firma HMAC-SHA256 con
 * FOLIO_ENC_HMAC_KEY (la misma key de los blind indexes — ver lib/crypto.ts)
 * sobre `turnoId + accion + exp`. Un replay del link es inocuo porque la
 * transición en DB es idempotente vía la state machine de M09 (el CAS de la
 * action afecta 0 filas si el estado ya cambió). La expiración es el INICIO
 * del turno: el token no sirve post-turno.
 *
 * ─── Formato (v1, ESTABLE — los tests lo replican para firmar payloads
 *     adversariales; cambiarlo = invalidar links ya emitidos) ───────────────
 *
 *   payload  = `${turnoId}.${accion}.${expMs}`          (utf8, en claro)
 *   sig      = HMAC-SHA256(key, "folio:confirm-turno:v1:" + payload)
 *   token    = base64url(payload) + "." + base64url(sig)
 *
 * URL-safe por construcción (base64url sin padding + un punto separador):
 * apto para path segment `/t/[token]` sin encoding adicional.
 *
 * Seguridad:
 *   - La firma cubre TODO el payload (turnoId, accion y exp): adulterar la
 *     expiración o cambiar confirmar→cancelar invalida el token.
 *   - Comparación timing-safe (patrón lib/security/verify-bearer: SHA-256 de
 *     ambos lados + timingSafeEqual — normaliza longitudes sin filtrarlas).
 *   - Se verifica la firma ANTES que la expiración: un token adulterado nunca
 *     llega a reportar "expirado" (no hay oráculo sobre el exp).
 *   - El token NO contiene PHI: solo un UUID de turno + acción + epoch.
 *
 * Módulo PURO (sin DB): server-only porque toca la HMAC key. Los unit tests
 * corren con `--conditions react-server` (stub vacío de server-only).
 */

import "server-only";

import { createHmac } from "node:crypto";

import { timingSafeEqualStrings } from "@/lib/security/verify-bearer";

export type ConfirmAccion = "confirmar" | "cancelar";

const ACCIONES: readonly ConfirmAccion[] = ["confirmar", "cancelar"];
const HMAC_CONTEXT = "folio:confirm-turno:v1:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
// data64(payload ~60 chars → ~80 b64) + "." + sig64 (43). Techo generoso.
const MAX_TOKEN_LEN = 256;

let cachedKey: Buffer | null = null;

/**
 * FOLIO_ENC_HMAC_KEY, 32 bytes base64 (mismo contrato que getHmacKey de
 * lib/crypto.ts — se replica acá para mantener este módulo chico y puro; una
 * key inválida truena idéntico en ambos).
 */
function getHmacKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FOLIO_ENC_HMAC_KEY;
  if (!raw) {
    throw new Error(
      "FOLIO_ENC_HMAC_KEY no definida. Generar con `openssl rand -base64 32` y setear en .env.local.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `FOLIO_ENC_HMAC_KEY debe ser 32 bytes (256 bits) en base64. Recibida: ${key.length} bytes.`,
    );
  }
  cachedKey = key;
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", getHmacKey())
    .update(HMAC_CONTEXT + payload, "utf8")
    .digest("base64url");
}

export interface BuildConfirmTokenInput {
  /** UUID del turno. */
  turnoId: string;
  accion: ConfirmAccion;
  /** Expiración en epoch MILISEGUNDOS — usar el inicio del turno. */
  expMs: number;
}

/**
 * Construye el token firmado. Lanza ante inputs malformados (error de
 * programación del caller, no input de usuario — el dispatcher arma esto
 * desde datos de DB ya validados).
 */
export function buildConfirmToken(input: BuildConfirmTokenInput): string {
  const { turnoId, accion, expMs } = input;
  if (!UUID_RE.test(turnoId)) {
    throw new Error("buildConfirmToken: turnoId debe ser un UUID.");
  }
  if (!ACCIONES.includes(accion)) {
    throw new Error(`buildConfirmToken: accion desconocida "${accion}".`);
  }
  if (!Number.isSafeInteger(expMs) || expMs <= 0) {
    throw new Error("buildConfirmToken: expMs debe ser epoch ms entero positivo.");
  }
  const payload = `${turnoId}.${accion}.${expMs}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export type VerifyConfirmTokenResult =
  | { ok: true; turnoId: string; accion: ConfirmAccion }
  | { ok: false; reason: "expirado" | "invalido" };

const INVALIDO: VerifyConfirmTokenResult = { ok: false, reason: "invalido" };

/**
 * Verifica un token recibido por URL. Nunca lanza ante input hostil: cualquier
 * malformación → `{ ok: false, reason: "invalido" }`. Firma OK pero exp
 * vencida (nowMs >= exp) → `"expirado"`. `nowMs` inyectable para tests.
 */
export function verifyConfirmToken(
  token: string,
  nowMs: number = Date.now(),
): VerifyConfirmTokenResult {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LEN) {
    return INVALIDO;
  }

  const dot = token.indexOf(".");
  // Exactamente 2 segmentos no vacíos (el payload decodificado tiene sus
  // propios puntos, pero el token en sí es data64.sig64).
  if (dot <= 0 || dot === token.length - 1 || token.indexOf(".", dot + 1) !== -1) {
    return INVALIDO;
  }
  const data64 = token.slice(0, dot);
  const sig64 = token.slice(dot + 1);
  if (!B64URL_RE.test(data64) || !B64URL_RE.test(sig64)) return INVALIDO;

  let payload: string;
  try {
    payload = Buffer.from(data64, "base64url").toString("utf8");
  } catch {
    return INVALIDO;
  }

  const parts = payload.split(".");
  if (parts.length !== 3) return INVALIDO;
  const [turnoId, accion, expStr] = parts;
  if (!UUID_RE.test(turnoId)) return INVALIDO;
  if (!/^\d{1,15}$/.test(expStr)) return INVALIDO;

  // Firma primero (timing-safe), DESPUÉS semántica: un token adulterado nunca
  // distingue entre "acción rara" y "firma rota" más allá de "invalido".
  if (!timingSafeEqualStrings(sign(payload), sig64)) return INVALIDO;

  if (!(ACCIONES as readonly string[]).includes(accion)) return INVALIDO;

  const expMs = Number(expStr);
  if (!Number.isSafeInteger(expMs)) return INVALIDO;
  if (nowMs >= expMs) return { ok: false, reason: "expirado" };

  return { ok: true, turnoId: turnoId.toLowerCase(), accion: accion as ConfirmAccion };
}

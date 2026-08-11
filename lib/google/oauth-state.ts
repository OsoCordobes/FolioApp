/**
 * Folio · state anti-CSRF del OAuth de Google Calendar.
 *
 * ─── Qué se rompía ─────────────────────────────────────────────────────────
 * El flow mandaba el `memberId` CRUDO como `state` y el callback solo
 * verificaba que ese member fuera del usuario logueado. Sin nonce, el `state`
 * era adivinable (el memberId se ve en la pantalla de Equipo y en el `?prof=`
 * de la agenda), así que un tercero podía autorizar SU cuenta de Google y
 * después mandarle a la víctima —ya logueada— el link
 * `/api/google/callback?code=<código del atacante>&state=<memberId de la
 * víctima>`. El callback hacía el exchange, guardaba los tokens del atacante
 * como integración de la víctima y a partir de ahí cada turno de la víctima se
 * pusheaba con nombre y email del paciente al calendario del atacante: fuga de
 * PHI fuera del tenant. Es el CSRF clásico de OAuth (code injection).
 *
 * ─── Cómo se arregla ───────────────────────────────────────────────────────
 * El `state` pasa a ser un nonce aleatorio de 32 bytes que NO se deriva de
 * nada. Su copia, junto con el memberId y el flag de onboarding, viaja en una
 * cookie httpOnly de vida corta que se setea al iniciar el flow. El callback
 * exige igualdad exacta entre el `state` del query y el de la cookie ANTES del
 * exchange, y saca el memberId de la COOKIE (nunca del query). Quien no inició
 * el flow en ese browser no tiene cookie → no hay exchange.
 *
 * ─── Formato de la cookie (v1) ─────────────────────────────────────────────
 *
 *   payload = `${state}.${memberId}.${onb ? 1 : 0}.${expMs}`
 *   sig     = HMAC-SHA256(FOLIO_ENC_HMAC_KEY, "folio:gcal-oauth-state:v1:" + payload)
 *   cookie  = base64url(payload) + "." + base64url(sig)
 *
 * La firma no es estrictamente necesaria contra el ataque de arriba (el
 * atacante no puede escribir cookies en el browser de la víctima), pero cierra
 * la inyección de cookies desde un subdominio: sin la key no se puede fabricar
 * un par (nonce, memberId) que el callback acepte. Mismo patrón y misma key
 * que lib/booking/confirm-token.ts.
 *
 * El `expMs` embebido duplica el `maxAge` de la cookie: el maxAge lo hace
 * cumplir el browser (que el atacante controla en el suyo), el exp firmado lo
 * hace cumplir el server.
 *
 * Módulo PURO (sin DB, sin next/headers): server-only porque toca la HMAC key.
 * Los unit tests corren con `--conditions react-server` (stub de server-only).
 */

import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { timingSafeEqualStrings } from "@/lib/security/verify-bearer";

/** Cookie httpOnly con el state + memberId + flag de onboarding. */
export const GOOGLE_OAUTH_STATE_COOKIE = "folio.gcal_oauth";

/**
 * Vida de la cookie. 10 minutos: alcanza para elegir cuenta y aceptar el
 * consent de Google incluso con 2FA, y deja una ventana chica si el browser
 * queda abierto en un consultorio compartido.
 */
export const GOOGLE_OAUTH_STATE_TTL_S = 600;

const HMAC_CONTEXT = "folio:gcal-oauth-state:v1:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
/** 32 bytes → 43 chars base64url sin padding. */
const STATE_BYTES = 32;
const STATE_LEN = 43;
// payload ~110 chars → ~150 b64 + "." + sig64 (43). Techo generoso.
const MAX_COOKIE_LEN = 512;

let cachedKey: Buffer | null = null;

/**
 * FOLIO_ENC_HMAC_KEY, 32 bytes base64 (mismo contrato que getHmacKey de
 * lib/crypto.ts y lib/booking/confirm-token.ts).
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

export interface BuildGoogleOAuthStateInput {
  /** UUID del member que está conectando su calendario. */
  memberId: string;
  /** `true` cuando el flow arranca en el Step 7 del wizard de onboarding. */
  fromOnboarding: boolean;
  /** Expiración en epoch ms. Default: ahora + GOOGLE_OAUTH_STATE_TTL_S. */
  expMs?: number;
}

export interface GoogleOAuthStatePair {
  /** Nonce que viaja a Google en `?state=` (público, opaco). */
  state: string;
  /** Valor firmado para la cookie httpOnly (nunca sale del browser). */
  cookieValue: string;
}

/**
 * Genera el par (state público, cookie firmada) de un nuevo flow.
 * Lanza ante inputs malformados: es error de programación del caller, el
 * memberId viene de la sesión ya resuelta.
 */
export function buildGoogleOAuthState(
  input: BuildGoogleOAuthStateInput,
  nowMs: number = Date.now(),
): GoogleOAuthStatePair {
  const { memberId, fromOnboarding } = input;
  if (!UUID_RE.test(memberId)) {
    throw new Error("buildGoogleOAuthState: memberId debe ser un UUID.");
  }
  const expMs = input.expMs ?? nowMs + GOOGLE_OAUTH_STATE_TTL_S * 1000;
  if (!Number.isSafeInteger(expMs) || expMs <= 0) {
    throw new Error("buildGoogleOAuthState: expMs debe ser epoch ms entero positivo.");
  }

  const state = randomBytes(STATE_BYTES).toString("base64url");
  const payload = `${state}.${memberId.toLowerCase()}.${fromOnboarding ? 1 : 0}.${expMs}`;
  return {
    state,
    cookieValue: `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`,
  };
}

export type VerifyGoogleOAuthStateResult =
  | { ok: true; memberId: string; fromOnboarding: boolean }
  | {
      ok: false;
      /**
       * `sin_cookie` — el flow no arrancó en este browser (o la cookie ya
       * venció/se consumió). `invalido` — cookie malformada o firma rota.
       * `expirado` — firma OK pero pasaron más de TTL. `mismatch` — el state
       * del query no es el de la cookie (el caso del ataque).
       */
      reason: "sin_cookie" | "invalido" | "expirado" | "mismatch";
      /**
       * Best-effort para elegir a dónde volver (wizard vs /configuracion).
       * Solo es dato de navegación, nunca de autorización: `false` cuando la
       * cookie no se pudo decodificar.
       */
      fromOnboarding: boolean;
    };

function fail(
  reason: "sin_cookie" | "invalido" | "expirado" | "mismatch",
  fromOnboarding = false,
): VerifyGoogleOAuthStateResult {
  return { ok: false, reason, fromOnboarding };
}

interface DecodedState {
  state: string;
  memberId: string;
  fromOnboarding: boolean;
  expMs: number;
}

/** Decodifica + verifica firma. `null` ante cualquier malformación. */
function decode(cookieValue: string): DecodedState | null {
  if (cookieValue.length === 0 || cookieValue.length > MAX_COOKIE_LEN) return null;

  const dot = cookieValue.indexOf(".");
  // Exactamente 2 segmentos no vacíos: data64.sig64 (el payload decodificado
  // tiene sus propios puntos, el valor de la cookie no).
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  if (cookieValue.indexOf(".", dot + 1) !== -1) return null;

  const data64 = cookieValue.slice(0, dot);
  const sig64 = cookieValue.slice(dot + 1);
  if (!B64URL_RE.test(data64) || !B64URL_RE.test(sig64)) return null;

  let payload: string;
  try {
    payload = Buffer.from(data64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const parts = payload.split(".");
  if (parts.length !== 4) return null;
  const [state, memberId, onbStr, expStr] = parts;
  if (state.length !== STATE_LEN || !B64URL_RE.test(state)) return null;
  if (!UUID_RE.test(memberId)) return null;
  if (onbStr !== "0" && onbStr !== "1") return null;
  if (!/^\d{1,15}$/.test(expStr)) return null;

  // Firma antes que semántica. Si la key falta o es inválida, ningún valor
  // puede ser legítimo → degradamos a null en vez de tirar un 500 en el
  // callback (el usuario ve el error amable de "reintentá la conexión").
  let esperada: string;
  try {
    esperada = sign(payload);
  } catch {
    return null;
  }
  if (!timingSafeEqualStrings(esperada, sig64)) return null;

  const expMs = Number(expStr);
  if (!Number.isSafeInteger(expMs)) return null;

  return { state, memberId: memberId.toLowerCase(), fromOnboarding: onbStr === "1", expMs };
}

/**
 * Verifica el retorno del callback. NUNCA lanza ante input hostil.
 *
 * Orden: firma → expiración → igualdad del state. El memberId devuelto sale
 * SIEMPRE de la cookie; el `queryState` solo se usa para compararlo.
 *
 * @param cookieValue valor crudo de la cookie `folio.gcal_oauth` (o null).
 * @param queryState  valor crudo de `?state=` que devolvió Google (o null).
 */
export function verifyGoogleOAuthState(
  cookieValue: string | null | undefined,
  queryState: string | null | undefined,
  nowMs: number = Date.now(),
): VerifyGoogleOAuthStateResult {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    return fail("sin_cookie");
  }

  const decoded = decode(cookieValue);
  if (!decoded) return fail("invalido");

  if (nowMs >= decoded.expMs) return fail("expirado", decoded.fromOnboarding);

  if (typeof queryState !== "string" || queryState.length === 0) {
    return fail("mismatch", decoded.fromOnboarding);
  }
  if (!timingSafeEqualStrings(decoded.state, queryState)) {
    return fail("mismatch", decoded.fromOnboarding);
  }

  return { ok: true, memberId: decoded.memberId, fromOnboarding: decoded.fromOnboarding };
}

/**
 * Opciones de la cookie, compartidas entre el seteo (server action) y el
 * borrado (callback) para que no puedan divergir — una cookie borrada con
 * atributos distintos a los del seteo NO se borra.
 *
 * `sameSite: "lax"` es el mínimo que funciona: el retorno de Google es una
 * navegación top-level GET, que Lax sí permite (Strict la bloquearía y el flow
 * nunca cerraría). `secure` solo en producción para no romper http://localhost.
 */
export function googleOAuthStateCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Folio · Google Calendar — salud de la integración + decisión del nudge.
 *
 * Módulo PURO (sin DB, sin googleapis, sin server-only): importable desde
 * Server Components, route handlers y Client Components, y testeable con
 * node:test (tests/unit/gcal-nudge-decision.test.ts).
 *
 * Conceptos:
 *   - "invalid_grant": Google revocó el refresh token (usuario quitó el
 *     acceso, OAuth app en modo Testing expiró a los 7 días, password reset,
 *     etc.). La integración queda MUERTA: ningún sync vuelve a andar hasta
 *     que el profesional re-corra el OAuth ("Reconectar").
 *   - La marca persiste en `integration.ultimo_error` con el prefijo
 *     `invalid_grant:` (la escriben los catch de push/webhook/cron). Un sync
 *     exitoso la limpia (ultimo_error = null), igual que el re-connect del
 *     callback OAuth.
 *   - El nudge de /hoy: banner para profesionales colegiados sin integración
 *     (modo "conectar") o con integración muerta (modo "reconectar"),
 *     dismissible client-side por 7 días (localStorage por member).
 */

/** Marca canónica que los catch persisten en `integration.ultimo_error`. */
export const INVALID_GRANT_MARKER = "invalid_grant";

/** Ventana de silencio tras dismissear el banner. */
export const GCAL_NUDGE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

/** Clave de localStorage del dismiss — por member, no por browser entero. */
export function gcalNudgeDismissKey(memberId: string): string {
  return `folio.gcal-nudge.dismissed.${memberId}`;
}

export type GcalNudgeModo = "conectar" | "reconectar";

/** Snapshot mínimo de la fila `integration` que la decisión necesita. */
export interface GcalIntegracionSnapshot {
  /** true si la fila existe pero NO tiene refresh_token (inutilizable). */
  sinToken: boolean;
  ultimoError: string | null;
  ultimoErrorTs: string | null;
}

/**
 * Detecta el invalid_grant de Google en un error arbitrario. Cubre las dos
 * formas en que googleapis lo presenta:
 *   - GaxiosError.message === "invalid_grant" (refresh de token).
 *   - response.data.error === "invalid_grant" (body OAuth crudo).
 * También matchea mensajes ya prefijados/envueltos ("invalid_grant: Token
 * has been expired or revoked").
 */
export function isInvalidGrantError(e: unknown): boolean {
  if (e == null) return false;
  const message =
    e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (message.toLowerCase().includes(INVALID_GRANT_MARKER)) return true;

  // GaxiosError: response.data = { error: "invalid_grant", ... }
  const response = (e as { response?: { data?: { error?: unknown } } }).response;
  return response?.data?.error === INVALID_GRANT_MARKER;
}

/**
 * ¿La integración está muerta (necesita re-OAuth)? true si no tiene refresh
 * token o si el último error registrado fue un invalid_grant que ningún sync
 * posterior limpió (los caminos de éxito ponen ultimo_error = null).
 */
export function esIntegracionMuerta(integracion: GcalIntegracionSnapshot): boolean {
  if (integracion.sinToken) return true;
  if (!integracion.ultimoErrorTs) return false;
  return (integracion.ultimoError ?? "").toLowerCase().includes(INVALID_GRANT_MARKER);
}

/**
 * ¿El dismiss sigue vigente? Vigente = timestamp válido, no futuro (un valor
 * corrupto/adelantado NO silencia para siempre: el banner reaparece y un
 * nuevo dismiss lo regenera) y dentro de la ventana de 7 días.
 */
export function isNudgeDismissVigente(
  dismissedAtMs: number | null | undefined,
  nowMs: number,
): boolean {
  if (dismissedAtMs == null || !Number.isFinite(dismissedAtMs)) return false;
  if (dismissedAtMs > nowMs) return false;
  return nowMs - dismissedAtMs < GCAL_NUDGE_DISMISS_MS;
}

/**
 * Decisión pura del banner de /hoy.
 *
 *   - Solo profesionales colegiados (es_colegiado): ASISTENTE/COORDINADOR
 *     no colegiados jamás lo ven — no tienen calendar propio que espejar.
 *   - Sin fila `integration` GOOGLE_CALENDAR → "conectar".
 *   - Fila muerta (invalid_grant / sin token) → "reconectar".
 *   - Integración sana, o con error transitorio (no invalid_grant: lo
 *     reintentan webhook/cron solos) → null, no molestar.
 *   - Dismiss vigente (client-side pasa el timestamp de localStorage;
 *     server-side pasa null) → null.
 */
export function decideGcalNudge(input: {
  esColegiado: boolean;
  integracion: GcalIntegracionSnapshot | null;
  dismissedAtMs?: number | null;
  nowMs?: number;
}): GcalNudgeModo | null {
  if (!input.esColegiado) return null;
  if (isNudgeDismissVigente(input.dismissedAtMs, input.nowMs ?? Date.now())) return null;
  if (input.integracion === null) return "conectar";
  if (esIntegracionMuerta(input.integracion)) return "reconectar";
  return null;
}

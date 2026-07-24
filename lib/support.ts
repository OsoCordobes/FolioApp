/**
 * Folio · contacto de soporte.
 *
 * Única fuente de verdad del email de soporte/asistencia. Antes había
 * placeholders @folio.app repartidos por la app (dominio que no es nuestro
 * — los mails rebotaban). Si el contacto cambia, se cambia ACÁ.
 *
 * soporte@foliosalud.com vive en el dominio propio (foliosalud.com) — el
 * buzón/forward lo administra el founder; un @gmail.com en la pantalla de
 * error de un SaaS médico de pago socavaba la percepción de seriedad.
 *
 * Es un string plano importable desde Server y Client Components.
 */

export const SUPPORT_EMAIL = "soporte@foliosalud.com";

/** mailto: con subject opcional (URL-encoded). */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

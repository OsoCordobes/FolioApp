/**
 * Folio · contacto de soporte.
 *
 * Única fuente de verdad del email de soporte/asistencia. Antes había
 * placeholders @folio.app repartidos por la app (dominio que no es nuestro
 * — los mails rebotaban). Si el contacto cambia, se cambia ACÁ.
 *
 * PENDIENTE (bloqueado por DNS): migrar a soporte@foliosalud.com cuando el
 * dominio tenga MX + forwarding configurado por el founder. Al 2026-07-24
 * foliosalud.com NO tiene registros MX — un mail a ese buzón rebota, y esta
 * dirección aparece en pantallas de error, legales y el reply-to de todos
 * los emails: hasta que el buzón reciba de verdad, se queda el Gmail.
 *
 * Es un string plano importable desde Server y Client Components.
 */

export const SUPPORT_EMAIL = "folioasistencia@gmail.com";

/** mailto: con subject opcional (URL-encoded). */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

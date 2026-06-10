/**
 * Folio · contacto de soporte.
 *
 * Única fuente de verdad del email de soporte/asistencia. Antes había
 * placeholders @folio.app repartidos por la app (dominio que no es nuestro
 * — los mails rebotaban). Si el contacto cambia, se cambia ACÁ.
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

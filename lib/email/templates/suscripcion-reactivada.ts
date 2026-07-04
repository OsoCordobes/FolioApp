/**
 * Folio · template de email "tu suscripción volvió a estar activa" (M65 · lifecycle).
 *
 * Función PURA (sin DB, sin Resend) → testeable. Se envía cuando un cobro
 * aprobado recupera una suscripción MOROSA → ACTIVA (recordChargeAttempt,
 * lib/db/suscripcion.ts). Cierra el episodio de morosidad que abrió
 * suscripcion.morosa_desde.
 */

import { ctaButton, esc, formatArs, p, pMuted, renderBillingEmail } from "./billing-common";

export interface SuscripcionReactivadaEmailInput {
  organizationNombre: string;
  /** Precio mensual del plan en centavos ARS. */
  montoMensualCents: number;
  /** URL absoluta a /configuracion/billing. */
  billingUrl: string;
}

export function buildSuscripcionReactivadaEmail(input: SuscripcionReactivadaEmailInput): {
  subject: string;
  html: string;
} {
  const subject = "Tu suscripción a Folio está activa de nuevo ✓";

  const bodyHtml = [
    p("Hola,"),
    p(
      `El cobro se procesó correctamente y la suscripción de <strong>${esc(input.organizationNombre)}</strong> volvió a estar <strong>activa</strong>. Ya tenés acceso completo a la agenda, las historias clínicas y las reservas online.`,
    ),
    p(
      `El plan mensual de <strong>${esc(formatArs(input.montoMensualCents))}</strong> se sigue debitando automáticamente cada mes vía Mercado Pago.`,
    ),
    ctaButton(input.billingUrl, "Ver mi suscripción"),
    pMuted("Gracias por seguir con Folio. Si algo no se ve bien, respondé este correo."),
  ].join("\n                ");

  return {
    subject,
    html: renderBillingEmail({ headerTitle: "Suscripción reactivada", bodyHtml }),
  };
}

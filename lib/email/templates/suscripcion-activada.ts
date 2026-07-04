/**
 * Folio · template de email "bienvenida — tu suscripción está activa"
 * (M65 · lifecycle).
 *
 * Función PURA (sin DB, sin Resend) → testeable. Se envía UNA vez por
 * preapproval cuando la suscripción pasa a ACTIVA por primera vez
 * (dedupe por mp_preapproval_id: una re-suscripción con preapproval nuevo
 * vuelve a dar la bienvenida, un webhook reenviado no).
 */

import { ctaButton, esc, formatArs, p, pMuted, renderBillingEmail } from "./billing-common";

export interface SuscripcionActivadaEmailInput {
  organizationNombre: string;
  /** Precio mensual del plan en centavos ARS. */
  montoMensualCents: number;
  /** URL absoluta a /configuracion/billing. */
  billingUrl: string;
}

export function buildSuscripcionActivadaEmail(input: SuscripcionActivadaEmailInput): {
  subject: string;
  html: string;
} {
  const subject = "Tu suscripción a Folio está activa 🎉";

  const bodyHtml = [
    p("Hola,"),
    p(
      `¡Gracias por sumarte! La suscripción de <strong>${esc(input.organizationNombre)}</strong> quedó <strong>activa</strong>: agenda, historias clínicas, recordatorios y reservas online, todo sin límites.`,
    ),
    p(
      `El plan es de <strong>${esc(formatArs(input.montoMensualCents))}/mes</strong> y se debita automáticamente cada mes vía Mercado Pago — no tenés que hacer nada más.`,
    ),
    ctaButton(input.billingUrl, "Ver mi suscripción"),
    pMuted(
      "Desde esa misma pantalla podés ver los cobros, actualizar el medio de pago o cancelar cuando quieras. Cualquier duda, respondé este correo.",
    ),
  ].join("\n                ");

  return {
    subject,
    html: renderBillingEmail({ headerTitle: "¡Bienvenido a Folio!", bodyHtml }),
  };
}

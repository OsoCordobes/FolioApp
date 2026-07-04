/**
 * Folio · template de email "cancelamos tu suscripción por falta de pago"
 * (M65 · lifecycle).
 *
 * Función PURA (sin DB, sin Resend) → testeable. Se envía cuando la
 * suscripción pasa a CANCELADA tras agotar la morosidad (MP cancela el
 * preapproval tras fallos consecutivos, o el cron de morosidad la cierra).
 * Reactivar crea un preapproval NUEVO desde /configuracion/billing
 * (createOrRenewPendingSubscription) — el viejo es terminal en MP.
 */

import { ctaButton, esc, formatArs, p, pMuted, renderBillingEmail } from "./billing-common";

export interface SuscripcionCanceladaMorosidadEmailInput {
  organizationNombre: string;
  /** Precio mensual del plan en centavos ARS (para retomar). */
  montoMensualCents: number;
  /** URL absoluta a /configuracion/billing. */
  billingUrl: string;
}

export function buildSuscripcionCanceladaMorosidadEmail(
  input: SuscripcionCanceladaMorosidadEmailInput,
): {
  subject: string;
  html: string;
} {
  const subject = "Tu suscripción a Folio fue cancelada por falta de pago";

  const bodyHtml = [
    p("Hola,"),
    p(
      `Después de varios intentos de cobro sin éxito, la suscripción de <strong>${esc(input.organizationNombre)}</strong> quedó <strong>cancelada</strong> y el acceso a la cuenta está pausado.`,
    ),
    p(
      `<strong>Tus datos no se borran:</strong> pacientes, turnos e historias clínicas quedan guardados y protegidos, conforme a los plazos de retención de la normativa argentina. Podés volver cuando quieras.`,
    ),
    p(
      `Para volver a usar Folio, creá una nueva suscripción de <strong>${esc(formatArs(input.montoMensualCents))}/mes</strong> desde la configuración de facturación — lleva un minuto y el acceso se restablece apenas se acredita el primer cobro.`,
    ),
    ctaButton(input.billingUrl, "Reactivar mi cuenta"),
    pMuted(
      "Si la cancelación te tomó por sorpresa o necesitás una mano con el medio de pago, respondé este correo y lo resolvemos juntos.",
    ),
  ].join("\n                ");

  return {
    subject,
    html: renderBillingEmail({ headerTitle: "Suscripción cancelada", bodyHtml }),
  };
}

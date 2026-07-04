/**
 * Folio · template de email "tu suscripción está suspendida" (M65 · lifecycle).
 *
 * Función PURA (sin DB, sin Resend) → testeable. Se envía cuando la ventana
 * de morosidad se agota y el access gate bloquea la app (computeAccessGate →
 * subscription_morosa_expired). Deja claro qué implica y cómo reactivar:
 * /configuracion/billing sigue siendo alcanzable aunque el gate bloquee el
 * resto (BILLING_RECOVERY_PATH, lib/db/suscripcion.ts).
 */

import { ctaButton, esc, formatArs, p, pMuted, renderBillingEmail } from "./billing-common";

export interface SuscripcionSuspendidaEmailInput {
  organizationNombre: string;
  /** Precio mensual del plan en centavos ARS (lo que hay que regularizar). */
  montoMensualCents: number;
  /** URL absoluta a /configuracion/billing. */
  billingUrl: string;
}

export function buildSuscripcionSuspendidaEmail(input: SuscripcionSuspendidaEmailInput): {
  subject: string;
  html: string;
} {
  const subject = "Tu suscripción a Folio quedó suspendida";

  const bodyHtml = [
    p("Hola,"),
    p(
      `Como los reintentos de cobro no funcionaron, la suscripción de <strong>${esc(input.organizationNombre)}</strong> quedó suspendida y el acceso a la agenda y a las historias clínicas está pausado.`,
    ),
    p(
      `<strong>Tus datos están a salvo:</strong> no se borra nada. Pacientes, turnos e historias quedan guardados tal como estaban, esperándote.`,
    ),
    p(
      `Para reactivar, entrá a la configuración de facturación y actualizá tu medio de pago (plan de <strong>${esc(formatArs(input.montoMensualCents))}/mes</strong>). El acceso se restablece apenas se acredita el cobro.`,
    ),
    ctaButton(input.billingUrl, "Reactivar suscripción"),
    pMuted("Si creés que esto es un error o necesitás ayuda, respondé este correo y lo vemos."),
  ].join("\n                ");

  return {
    subject,
    html: renderBillingEmail({ headerTitle: "Suscripción suspendida", bodyHtml }),
  };
}

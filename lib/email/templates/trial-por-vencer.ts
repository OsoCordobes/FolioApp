/**
 * Folio · template de email "tu prueba está por vencer" (M65 · lifecycle).
 *
 * Función PURA (sin DB, sin Resend) → testeable. El caller (notify.ts)
 * resuelve org, monto del plan y la URL absoluta de billing.
 * Se envía en los umbrales del grace period de 30 días: 7, 3 y 1 día(s).
 */

import type { TrialUmbralDias } from "@/lib/billing/lifecycle";

import { ctaButton, esc, formatArs, p, pMuted, renderBillingEmail } from "./billing-common";

export interface TrialPorVencerEmailInput {
  organizationNombre: string;
  /** Umbral del recordatorio: 7 (primer aviso), 3, o 1 (último aviso). */
  diasRestantes: TrialUmbralDias;
  /** Precio mensual del plan de la org en centavos ARS. */
  montoMensualCents: number;
  /** URL absoluta a /configuracion/billing. */
  billingUrl: string;
}

export function buildTrialPorVencerEmail(input: TrialPorVencerEmailInput): {
  subject: string;
  html: string;
} {
  const cuando = input.diasRestantes === 1 ? "mañana" : `en ${input.diasRestantes} días`;
  const subject = `Tu período de prueba de Folio termina ${cuando}`;

  const bodyHtml = [
    p("Hola,"),
    p(
      `El período de prueba de <strong>${esc(input.organizationNombre)}</strong> en Folio termina <strong>${esc(cuando)}</strong>.`,
    ),
    p(
      `Para seguir usando la agenda, las historias clínicas y las reservas online sin interrupciones, activá tu suscripción de <strong>${esc(formatArs(input.montoMensualCents))}/mes</strong>. Se cobra automáticamente cada mes vía Mercado Pago y podés cancelarla cuando quieras.`,
    ),
    ctaButton(input.billingUrl, "Activar suscripción"),
    pMuted(
      "Si no activás la suscripción, el acceso se pausa al terminar la prueba — pero tus datos quedan guardados y podés retomar en cualquier momento.",
    ),
  ].join("\n                ");

  return {
    subject,
    html: renderBillingEmail({ headerTitle: "Tu prueba está por terminar", bodyHtml }),
  };
}

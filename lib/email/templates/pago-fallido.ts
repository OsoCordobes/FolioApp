/**
 * Folio · template de email "no pudimos cobrar tu suscripción" (M65 · lifecycle).
 *
 * Función PURA (sin DB, sin Resend) → testeable. `humanizarErrorPago` traduce
 * el status_detail crudo de Mercado Pago (persistido en suscripcion.
 * ultimo_error) a una frase es-AR sin jerga; NUNCA se muestra el string crudo
 * al usuario (puede venir en inglés técnico). Exportada para tests.
 */

import { ctaButton, esc, formatArs, p, pMuted, renderBillingEmail } from "./billing-common";

export interface PagoFallidoEmailInput {
  organizationNombre: string;
  /** Monto del cobro que falló, en centavos ARS. */
  montoCents: number;
  /**
   * status_detail crudo de MP o texto de `suscripcion.ultimo_error`.
   * null si no se conoce la causa.
   */
  ultimoError: string | null;
  /** URL absoluta a /configuracion/billing. */
  billingUrl: string;
}

const ERROR_HUMANO: ReadonlyArray<[needle: string, copy: string]> = [
  ["cc_rejected_insufficient_amount", "La tarjeta no tenía fondos suficientes."],
  ["cc_rejected_bad_filled_security_code", "El código de seguridad de la tarjeta no es válido."],
  ["cc_rejected_bad_filled_date", "La fecha de vencimiento de la tarjeta no es válida."],
  ["cc_rejected_bad_filled_other", "Algún dato de la tarjeta no es válido."],
  ["cc_rejected_call_for_authorize", "El banco pidió que autorices el pago antes de procesarlo."],
  ["cc_rejected_card_disabled", "La tarjeta está deshabilitada — hay que activarla con el banco."],
  ["cc_rejected_duplicated_payment", "El banco detectó un pago duplicado y lo rechazó."],
  ["cc_rejected_max_attempts", "Se superó el máximo de intentos permitidos por el banco."],
  ["cc_rejected_high_risk", "El medio de pago rechazó el cobro por controles de seguridad."],
  ["cc_rejected_blacklist", "El medio de pago rechazó el cobro por controles de seguridad."],
  ["insufficient", "La cuenta no tenía fondos suficientes."],
];

/**
 * Traduce el error crudo de MP a copy es-AR. Matching por substring
 * (los status_detail a veces vienen con prefijos/sufijos). Fallback genérico
 * si no se reconoce o es null — jamás se muestra el crudo.
 */
export function humanizarErrorPago(raw: string | null): string {
  if (raw) {
    const lowered = raw.toLowerCase();
    for (const [needle, copy] of ERROR_HUMANO) {
      if (lowered.includes(needle)) return copy;
    }
  }
  return "El medio de pago rechazó el cobro.";
}

export function buildPagoFallidoEmail(input: PagoFallidoEmailInput): {
  subject: string;
  html: string;
} {
  const subject = "No pudimos procesar el cobro de tu suscripción a Folio";
  const motivo = humanizarErrorPago(input.ultimoError);

  const bodyHtml = [
    p("Hola,"),
    p(
      `El cobro mensual de <strong>${esc(formatArs(input.montoCents))}</strong> de la suscripción de <strong>${esc(input.organizationNombre)}</strong> no se pudo procesar.`,
    ),
    p(`<strong>Motivo:</strong> ${esc(motivo)}`),
    p(
      "No hace falta que hagas nada urgente: <strong>Mercado Pago va a reintentar el cobro automáticamente</strong> en los próximos días. Si querés resolverlo ahora, revisá tu medio de pago:",
    ),
    ctaButton(input.billingUrl, "Revisar mi medio de pago"),
    pMuted(
      "Mientras tanto seguís teniendo acceso normal. Si los reintentos fallan, te vamos a avisar antes de pausar la cuenta.",
    ),
  ].join("\n                ");

  return {
    subject,
    html: renderBillingEmail({ headerTitle: "Problema con el cobro", bodyHtml }),
  };
}

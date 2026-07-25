/**
 * Folio · cliente de email (Resend) — FAIL-SAFE y HONESTO.
 *
 * Principio de diseño idéntico a lib/google/sync.ts: enviar un email JAMÁS
 * debe romper una reserva. `sendEmail` NUNCA lanza — pero tampoco miente:
 * devuelve un resultado discriminado para que el caller sepa si el email
 * salió de verdad:
 *
 *   - 'sent'      → Resend aceptó el envío.
 *   - 'simulated' → sin RESEND_API_KEY: se logueó y NO se envió nada. Cuando
 *                   se configure la key, el envío real se activa solo.
 *   - 'failed'    → Resend devolvió error (API) o lanzó (red). Se captura en
 *                   Sentry y el detalle viaja en `detail`.
 *
 * Los callers fire-and-forget (lib/email/notify.ts) pueden ignorar el
 * resultado sin cambios; los que persisten estado de entrega (el dispatcher
 * de recordatorios) DEBEN mirarlo antes de marcar nada como enviado.
 *
 * `resend` se importa dinámicamente para no cargar el SDK ni fallar en build
 * cuando no hay key.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /**
   * Reply-To opcional. El from es un noreply, así que el Reply-To es el
   * interlocutor REAL de cada email: soporte de Folio en los emails a
   * profesionales (invitaciones, billing, pedidos), y el email de contacto
   * del consultorio en los emails a pacientes (booking/recordatorios —
   * resuelto por lib/email/notify.ts; si no hay, sale sin Reply-To).
   */
  replyTo?: string;
}

/** Resultado discriminado de un intento de envío. Nunca se lanza más allá. */
export type SendEmailResult =
  | { status: "sent" }
  | { status: "simulated"; detail: string }
  | { status: "failed"; detail: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Folio <noreply@folio.app>";

  if (!apiKey) {
    console.info("[email] RESEND_API_KEY ausente — simulando envío", {
      to: input.to,
      subject: input.subject,
    });
    return { status: "simulated", detail: "RESEND_API_KEY ausente" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    // El SDK NO lanza ante errores de API (key inválida, dominio sin
    // verificar): los devuelve en `error`. Solo lanza ante fallas de red.
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    if (error) {
      const detail = `${error.name}: ${error.message}`;
      const { captureException } = await import("@sentry/nextjs");
      captureException(new Error(`Resend API error — ${detail}`), {
        tags: { component: "email" },
        extra: { to: input.to, subject: input.subject },
      });
      return { status: "failed", detail };
    }
    return { status: "sent" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "email" },
      extra: { to: input.to, subject: input.subject },
    });
    return { status: "failed", detail };
  }
}

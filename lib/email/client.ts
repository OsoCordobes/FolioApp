/**
 * Folio · cliente de email (Resend) — FAIL-SAFE.
 *
 * Principio de diseño idéntico a lib/google/sync.ts: enviar un email JAMÁS
 * debe romper una reserva. Si no hay `RESEND_API_KEY` configurada, logueamos
 * y devolvemos (modo "simulado"); cuando se agregue la key, el envío real se
 * activa solo. `resend` se importa dinámicamente para no cargar el SDK ni
 * fallar en build cuando no hay key.
 *
 * `sendEmail` NUNCA lanza: cualquier error de red/API se captura en Sentry.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /**
   * Reply-To opcional. Usarlo solo cuando la respuesta debe ir a Folio
   * (ej. emails a profesionales). Los emails a pacientes NO lo setean:
   * su interlocutor es el consultorio, no el soporte de Folio.
   */
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Folio <noreply@folio.app>";

  if (!apiKey) {
    console.info("[email] RESEND_API_KEY ausente — simulando envío", {
      to: input.to,
      subject: input.subject,
    });
    return;
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "email" },
      extra: { to: input.to, subject: input.subject },
    });
  }
}

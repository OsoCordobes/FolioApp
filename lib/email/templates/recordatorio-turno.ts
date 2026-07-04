/**
 * Folio · templates de email de recordatorios de turno (fallback de WhatsApp).
 *
 * Funciones PURAS (sin DB, sin Resend) → testeables. Espejo 1:1 de los
 * templates WhatsApp del dispatcher (lib/whatsapp/templates.ts): mismas
 * variantes (CONFIRMACION_24H / RECORDATORIO_2H / POST_VISITA) y mismos
 * datos. El caller pre-computa `fecha`/`hora` con Intl en la timezone de la
 * org para que el template no dependa del entorno.
 *
 * No importa folio.css: los emails se renderizan en clientes de correo que
 * ignoran hojas externas. Estilos inline mínimos, paleta brass/cream
 * (mismo esqueleto que booking-confirmada.ts).
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Esqueleto compartido brass/cream: header + cuerpo + footer "Enviado por Folio". */
function wrap(headerTitle: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2622;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid #e6dcc8;overflow:hidden;">
            <tr>
              <td style="background:#8a6d3b;padding:20px 28px;">
                <h1 style="margin:0;color:#fffdf8;font-size:20px;font-weight:600;">${esc(headerTitle)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #e6dcc8;color:#9a8e7c;font-size:12px;">
                Enviado por Folio
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ─── CONFIRMACION_24H ───────────────────────────────────────────────────────

export interface Confirmacion24hEmailInput {
  pacienteNombre: string;
  consultorioNombre: string;
  servicioNombre: string;
  fecha: string; // "mié 14 may" — pre-formateada es-AR con TZ de la org
  hora: string; // "10:00"
  direccion?: string | null;
}

export function buildConfirmacion24hEmail(input: Confirmacion24hEmailInput): {
  subject: string;
  html: string;
} {
  const subject = `Recordatorio: tu turno de mañana en ${input.consultorioNombre}`;
  const direccionBlock = input.direccion
    ? `<p style="margin:4px 0;color:#6b5e4f;font-size:14px;">📍 ${esc(input.direccion)}</p>`
    : "";

  const body = `<p style="margin:0 0 16px;font-size:16px;">Hola ${esc(input.pacienteNombre)},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Te recordamos tu turno de mañana en <strong>${esc(input.consultorioNombre)}</strong>.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;border-radius:8px;padding:16px;margin:0 0 16px;">
                  <tr><td style="padding:16px;">
                    <p style="margin:0 0 8px;font-size:15px;"><strong>${esc(input.servicioNombre)}</strong></p>
                    <p style="margin:4px 0;color:#6b5e4f;font-size:14px;">🗓 ${esc(input.fecha)} · ${esc(input.hora)} hs</p>
                    ${direccionBlock}
                  </td></tr>
                </table>
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">Si necesitás reprogramar o cancelar, contactá al consultorio.</p>`;

  return { subject, html: wrap("Recordatorio de turno", body) };
}

// ─── RECORDATORIO_2H ────────────────────────────────────────────────────────

export interface Recordatorio2hEmailInput {
  pacienteNombre: string;
  consultorioNombre: string;
  hora: string; // "10:00" — pre-formateada es-AR con TZ de la org
}

export function buildRecordatorio2hEmail(input: Recordatorio2hEmailInput): {
  subject: string;
  html: string;
} {
  const subject = `Hoy a las ${input.hora} hs: tu turno en ${input.consultorioNombre}`;

  const body = `<p style="margin:0 0 16px;font-size:16px;">Hola ${esc(input.pacienteNombre)},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Te esperamos hoy a las <strong>${esc(input.hora)} hs</strong> en <strong>${esc(input.consultorioNombre)}</strong>.</p>
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">Si no llegás a venir, avisá al consultorio así liberamos el horario.</p>`;

  return { subject, html: wrap("Tu turno es hoy", body) };
}

// ─── POST_VISITA ────────────────────────────────────────────────────────────

export interface PostVisitaEmailInput {
  pacienteNombre: string;
  profesionalNombre: string;
  memoCorto: string; // puede venir vacío
}

export function buildPostVisitaEmail(input: PostVisitaEmailInput): {
  subject: string;
  html: string;
} {
  const subject = `Indicaciones de tu visita — ${input.profesionalNombre}`;
  const memoBlock = input.memoCorto
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;border-radius:8px;padding:16px;margin:0 0 16px;">
                  <tr><td style="padding:16px;">
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#2b2622;">${esc(input.memoCorto)}</p>
                  </td></tr>
                </table>`
    : "";

  const body = `<p style="margin:0 0 16px;font-size:16px;">Hola ${esc(input.pacienteNombre)},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Gracias por tu visita a <strong>${esc(input.profesionalNombre)}</strong>. ${input.memoCorto ? "Te dejamos las indicaciones de hoy:" : "Cualquier consulta, escribinos."}</p>
                ${memoBlock}
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">Ante cualquier duda sobre las indicaciones, contactá al consultorio.</p>`;

  return { subject, html: wrap("Gracias por tu visita", body) };
}

/**
 * Folio · template de email "solicitud de turno recibida".
 *
 * Se envía cuando la auto-confirmación está apagada (o no se pudo confirmar):
 * el pedido queda PENDIENTE a que el profesional lo acepte. Función PURA;
 * mismas convenciones que booking-confirmada (estilos inline, sin folio.css,
 * `fechaHoraLabel` y `portalUrl` pre-computados por el caller). Sin link de
 * calendario acá: el turno todavía NO está confirmado.
 */

import { ctaButton, esc, preheader } from "./billing-common";
import { contactoConsultorioCopy, type BookingEmailInput } from "./booking-confirmada";

export function buildBookingRecibidaEmail(input: BookingEmailInput): {
  subject: string;
  html: string;
} {
  const subject = "Recibimos tu solicitud de turno";
  const preheaderTexto = `Tu solicitud para el ${input.fechaHoraLabel} en ${input.organizationNombre}`;
  const direccionBlock = input.direccion
    ? `<p style="margin:4px 0;color:#6b5e4f;font-size:14px;">📍 ${esc(input.direccion)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2622;">
    ${preheader(preheaderTexto)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid #e6dcc8;overflow:hidden;">
            <tr>
              <td style="background:#8a6d3b;padding:20px 28px;">
                <h1 style="margin:0;color:#fffdf8;font-size:20px;font-weight:600;">Solicitud recibida · ${esc(input.organizationNombre)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;">Hola ${esc(input.pacienteNombre)},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Recibimos tu solicitud de turno en <strong>${esc(input.organizationNombre)}</strong>. Todavía <strong>no está confirmada</strong>: el consultorio la va a revisar y te avisamos apenas quede confirmada.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;border-radius:8px;padding:16px;margin:0 0 16px;">
                  <tr><td style="padding:16px;">
                    <p style="margin:0 0 8px;font-size:15px;"><strong>${esc(input.servicioNombre)}</strong></p>
                    <p style="margin:4px 0;color:#6b5e4f;font-size:14px;">🗓 ${esc(input.fechaHoraLabel)}</p>
                    ${direccionBlock}
                  </td></tr>
                </table>
                ${ctaButton(input.portalUrl, "Gestionar mi turno")}
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">No hace falta que hagas nada más por ahora. Si querés modificar tu solicitud, ${contactoConsultorioCopy(input.telefonoPublico)}.</p>
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

  return { subject, html };
}

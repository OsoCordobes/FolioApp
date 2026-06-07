/**
 * Folio · template de email "turno confirmado".
 *
 * Función PURA (sin DB, sin Resend) → testeable. El caller pre-computa
 * `fechaHoraLabel` con Intl.DateTimeFormat en la timezone de la org para que
 * el template no dependa del entorno.
 *
 * No importa folio.css: los emails se renderizan en clientes de correo que
 * ignoran hojas externas. Estilos inline mínimos, paleta brass/cream.
 */

export interface BookingEmailInput {
  pacienteNombre: string;
  organizationNombre: string;
  servicioNombre: string;
  fechaHoraLabel: string;
  direccion?: string | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBookingConfirmadaEmail(input: BookingEmailInput): {
  subject: string;
  html: string;
} {
  const subject = "Tu turno está confirmado ✓";
  const direccionBlock = input.direccion
    ? `<p style="margin:4px 0;color:#6b5e4f;font-size:14px;">📍 ${esc(input.direccion)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2622;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid #e6dcc8;overflow:hidden;">
            <tr>
              <td style="background:#8a6d3b;padding:20px 28px;">
                <h1 style="margin:0;color:#fffdf8;font-size:20px;font-weight:600;">Turno confirmado</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;">Hola ${esc(input.pacienteNombre)},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Tu turno en <strong>${esc(input.organizationNombre)}</strong> quedó confirmado.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;border-radius:8px;padding:16px;margin:0 0 16px;">
                  <tr><td style="padding:16px;">
                    <p style="margin:0 0 8px;font-size:15px;"><strong>${esc(input.servicioNombre)}</strong></p>
                    <p style="margin:4px 0;color:#6b5e4f;font-size:14px;">🗓 ${esc(input.fechaHoraLabel)}</p>
                    ${direccionBlock}
                  </td></tr>
                </table>
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">Si necesitás reprogramar o cancelar, respondé este correo o contactá al consultorio.</p>
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

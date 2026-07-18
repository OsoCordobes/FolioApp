/**
 * Folio · template de email "nuevo pedido de turno" (para el PROFESIONAL).
 *
 * Se envía al owner de la org (o al profesional destino si el pedido lo trae)
 * cuando entra un pedido que queda PENDIENTE: webhook de WhatsApp y booking
 * público sin auto-confirmación. Cierra el gap de que nadie se enteraba de un
 * pedido nuevo hasta abrir /calendario.
 *
 * Función PURA (sin DB, sin Resend) → testeable; mismas convenciones que
 * member-invitation (estilos inline, sin folio.css, labels pre-computados por
 * el caller). PHI mínima deliberada: nombre del solicitante y canal — NUNCA
 * motivo/notas clínicas ni teléfono/email del paciente.
 */

export interface PedidoNuevoEmailInput {
  organizationNombre: string;
  /** Nombre del solicitante (único dato personal que viaja — sin motivo/notas). */
  pacienteNombre: string;
  /** Etiqueta legible del canal, ya resuelta con canalPedidoLabel(). */
  canalLabel: string;
  /** Fecha/hora propuesta formateada por el caller, o null si el pedido no trae. */
  fechaHoraLabel: string | null;
  /** Link absoluto a /calendario (getAppUrl() + "/calendario"). */
  calendarioUrl: string;
}

/**
 * canal_pedido (enum DB: WEB | WHATSAPP | INSTAGRAM | TELEFONO) → etiqueta
 * humana para el email. Valor desconocido degrada al crudo (defensivo: un
 * canal nuevo en DB no debe romper el envío).
 */
export function canalPedidoLabel(canal: string): string {
  switch (canal) {
    case "WEB":
      return "reserva web";
    case "WHATSAPP":
      return "WhatsApp";
    case "INSTAGRAM":
      return "Instagram";
    case "TELEFONO":
      return "teléfono";
    case "PORTAL":
      return "portal del paciente";
    default:
      return canal;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPedidoNuevoEmail(input: PedidoNuevoEmailInput): {
  subject: string;
  html: string;
} {
  const subject = `Nuevo pedido de turno — ${input.pacienteNombre}`;

  const fechaBlock = input.fechaHoraLabel
    ? `<p style="margin:4px 0;color:#6b5e4f;font-size:14px;">🗓 Horario propuesto: ${esc(input.fechaHoraLabel)}</p>`
    : `<p style="margin:4px 0;color:#6b5e4f;font-size:14px;">Sin horario propuesto — coordinalo al aceptar el pedido.</p>`;

  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2622;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid #e6dcc8;overflow:hidden;">
            <tr>
              <td style="background:#8a6d3b;padding:20px 28px;">
                <h1 style="margin:0;color:#fffdf8;font-size:20px;font-weight:600;">Nuevo pedido de turno</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;">Hola,</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;"><strong>${esc(input.pacienteNombre)}</strong> pidió un turno por ${esc(input.canalLabel)} en <strong>${esc(input.organizationNombre)}</strong>. El pedido está pendiente de tu confirmación.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;border-radius:8px;margin:0 0 20px;">
                  <tr><td style="padding:16px;">
                    ${fechaBlock}
                  </td></tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
                  <tr>
                    <td style="background:#8a6d3b;border-radius:8px;">
                      <a href="${esc(input.calendarioUrl)}" style="display:inline-block;padding:12px 24px;color:#fffdf8;font-size:15px;font-weight:600;text-decoration:none;">Ver en el calendario</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">Desde la bandeja de pedidos podés aceptarlo, proponer otro horario o rechazarlo.</p>
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

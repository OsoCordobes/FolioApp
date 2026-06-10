/**
 * Folio · template de email "te invitaron a un equipo".
 *
 * Función PURA (sin DB, sin Resend) → testeable. El caller pre-computa
 * `expiraLabel` con Intl.DateTimeFormat en la timezone de la org y arma el
 * `acceptUrl` ({APP_URL}/invitacion/{token} — el token crudo SOLO viaja acá,
 * nunca se persiste ni se loguea).
 *
 * No importa folio.css: estilos inline mínimos, paleta brass/cream — mismo
 * criterio que booking-confirmada.ts.
 */

export interface MemberInvitationEmailInput {
  organizationNombre: string;
  /** Etiqueta del rol ya resuelta con roleLabel() (ej. "Médico/a"). */
  rolLabel: string;
  /** Nombre de quien invita, o null si no está disponible. */
  invitadoPorNombre: string | null;
  /** Link completo de aceptación (contiene el token crudo). */
  acceptUrl: string;
  /** Vencimiento formateado, ej. "17 de junio de 2026". */
  expiraLabel: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMemberInvitationEmail(input: MemberInvitationEmailInput): {
  subject: string;
  html: string;
} {
  const subject = `Te invitaron a sumarte a ${input.organizationNombre} en Folio`;
  const invitadoPor = input.invitadoPorNombre
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;"><strong>${esc(input.invitadoPorNombre)}</strong> te invitó a sumarte al equipo de <strong>${esc(input.organizationNombre)}</strong> como <strong>${esc(input.rolLabel)}</strong>.</p>`
    : `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Te invitaron a sumarte al equipo de <strong>${esc(input.organizationNombre)}</strong> como <strong>${esc(input.rolLabel)}</strong>.</p>`;

  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2622;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid #e6dcc8;overflow:hidden;">
            <tr>
              <td style="background:#8a6d3b;padding:20px 28px;">
                <h1 style="margin:0;color:#fffdf8;font-size:20px;font-weight:600;">Invitación al equipo</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;">Hola,</p>
                ${invitadoPor}
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Para aceptar, entrá al link y creá tu cuenta (o iniciá sesión si ya tenés una con este email):</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                  <tr>
                    <td style="background:#8a6d3b;border-radius:8px;">
                      <a href="${esc(input.acceptUrl)}" style="display:inline-block;padding:12px 24px;color:#fffdf8;font-size:15px;font-weight:600;text-decoration:none;">Aceptar invitación</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;color:#6b5e4f;font-size:13px;line-height:1.5;">Si el botón no funciona, copiá y pegá este link en tu navegador:</p>
                <p style="margin:0 0 16px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${esc(input.acceptUrl)}" style="color:#8a6d3b;">${esc(input.acceptUrl)}</a></p>
                <p style="margin:0;color:#6b5e4f;font-size:13px;line-height:1.5;">La invitación vence el ${esc(input.expiraLabel)}. Si no esperabas este correo, podés ignorarlo — nadie accede a nada sin este link.</p>
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

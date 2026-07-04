/**
 * Folio · helpers compartidos de los templates de email de billing (M65).
 *
 * Los seis templates de lifecycle (trial-por-vencer, pago-fallido,
 * suscripcion-*) comparten el layout brass/cream de booking-confirmada.ts.
 * En vez de duplicar esc() + formato ARS + el esqueleto HTML seis veces,
 * viven acá. Todo PURO (sin DB, sin Resend, sin Intl con dependencia de
 * entorno) → testeable determinísticamente.
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Centavos ARS → "$ 30.000" (separador de miles con punto, decimales con coma
 * solo si los hay). Hecho a mano — no Intl.NumberFormat — para que el output
 * sea idéntico en cualquier runtime/ICU y los tests puedan assertear literal.
 */
export function formatArs(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const pesos = Math.trunc(abs / 100);
  const centavos = abs % 100;
  const miles = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = centavos > 0 ? `,${String(centavos).padStart(2, "0")}` : "";
  return `${negative ? "-" : ""}$ ${miles}${dec}`;
}

/** Botón CTA (tabla, no <button> — los clientes de correo ignoran CSS externo). */
export function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                  <tr>
                    <td style="background:#8a6d3b;border-radius:8px;">
                      <a href="${esc(url)}" style="display:inline-block;padding:12px 24px;color:#fffdf8;font-size:15px;font-weight:600;text-decoration:none;">${esc(label)}</a>
                    </td>
                  </tr>
                </table>`;
}

/** Párrafo estándar del cuerpo. */
export function p(innerHtml: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${innerHtml}</p>`;
}

/** Párrafo secundario (letra chica, tinta apagada). */
export function pMuted(innerHtml: string): string {
  return `<p style="margin:0 0 8px;color:#6b5e4f;font-size:13px;line-height:1.5;">${innerHtml}</p>`;
}

export interface BillingLayoutInput {
  /** Título del header brass (texto plano, se escapa acá). */
  headerTitle: string;
  /** Cuerpo ya renderizado (los helpers de arriba escapan sus inputs). */
  bodyHtml: string;
}

/** Esqueleto completo del email — mismo layout que booking-confirmada.ts. */
export function renderBillingEmail(input: BillingLayoutInput): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2622;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid #e6dcc8;overflow:hidden;">
            <tr>
              <td style="background:#8a6d3b;padding:20px 28px;">
                <h1 style="margin:0;color:#fffdf8;font-size:20px;font-weight:600;">${esc(input.headerTitle)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${input.bodyHtml}
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

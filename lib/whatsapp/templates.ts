/**
 * Folio · catálogo de templates WhatsApp aprobados (es_AR).
 *
 * Cada template debe estar PRE-APROBADO por Meta (24-48h proceso de review).
 * Estructura:
 *   - name: nombre exacto registrado en WhatsApp Business Manager
 *   - language: "es_AR"
 *   - body: texto con placeholders {{1}} {{2}} ...
 *
 * Estos textos son SOLO REFERENCIA — el servidor de Meta tiene la versión
 * oficial; este file documenta los placeholders y arma los components
 * correctos al llamar sendTemplate().
 *
 * Templates a aprobar al inicio (mandar para review en F11 launch):
 *   1. folio_confirmacion_24h_v1   — confirmación día anterior
 *   2. folio_recordatorio_2h_v1    — recordatorio mismo día
 *   3. folio_post_visita_v1        — memo post-sesión
 *   4. folio_reagendado_v1         — notificación de cambio
 *   5. folio_pago_pendiente_v1     — recordatorio de pago
 */

import { sendTemplate } from "./client";

interface ConfirmacionInput {
  to: string;                                 // teléfono E.164 sin +
  pacienteNombre: string;
  fecha: string;                              // "mié 14 may"
  hora: string;                               // "10:00"
  consultorioNombre: string;
  direccion: string;
  servicio: string;
}

export async function sendConfirmacion24h(input: ConfirmacionInput) {
  return sendTemplate({
    to: input.to,
    templateName: "folio_confirmacion_24h_v1",
    languageCode: "es_AR",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: input.pacienteNombre },
          { type: "text", text: input.fecha },
          { type: "text", text: input.hora },
          { type: "text", text: input.servicio },
          { type: "text", text: input.consultorioNombre },
          { type: "text", text: input.direccion },
        ],
      },
    ],
  });
}

interface RecordatorioInput {
  to: string;
  pacienteNombre: string;
  hora: string;
  consultorioNombre: string;
}

export async function sendRecordatorio2h(input: RecordatorioInput) {
  return sendTemplate({
    to: input.to,
    templateName: "folio_recordatorio_2h_v1",
    languageCode: "es_AR",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: input.pacienteNombre },
          { type: "text", text: input.hora },
          { type: "text", text: input.consultorioNombre },
        ],
      },
    ],
  });
}

interface PostVisitaInput {
  to: string;
  pacienteNombre: string;
  memoCorto: string;                          // primeros 120 chars del memo
  profesionalNombre: string;
}

export async function sendPostVisita(input: PostVisitaInput) {
  return sendTemplate({
    to: input.to,
    templateName: "folio_post_visita_v1",
    languageCode: "es_AR",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: input.pacienteNombre },
          { type: "text", text: input.memoCorto.slice(0, 1024) },
          { type: "text", text: input.profesionalNombre },
        ],
      },
    ],
  });
}

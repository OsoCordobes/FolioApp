/**
 * Folio · WhatsApp webhook (inbound + status).
 *
 * GET → handshake de verificación de Meta (responder hub.challenge si el
 *       hub.verify_token coincide con WHATSAPP_WEBHOOK_VERIFY_TOKEN).
 * POST → eventos:
 *   - messages: mensaje entrante de un paciente (probablemente reserva
 *     informal: "hola, quería un turno para el lunes"). Lo convertimos a
 *     un `pedido` con canal=WHATSAPP y nombre=desde el contacto.
 *   - statuses: delivery report de un template que enviamos (delivered,
 *     read, failed). Actualizamos `recordatorio_job.enviado_ts` o flagging.
 *
 * Seguridad:
 *   - Verify token en GET (Meta lo manda en cada handshake).
 *   - X-Hub-Signature-256: validar HMAC SHA256 del body con APP_SECRET.
 *     En F11 polish.
 */

import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface WhatsAppWebhookEntry {
  changes: Array<{
    value: {
      messaging_product: "whatsapp";
      metadata: { phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: "text" | "image" | "audio" | "video" | "document" | "interactive";
        text?: { body: string };
      }>;
      statuses?: Array<{
        id: string;
        status: "sent" | "delivered" | "read" | "failed";
        timestamp: string;
        recipient_id: string;
      }>;
    };
    field: "messages";
  }>;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { entry: WhatsAppWebhookEntry[] };

  // TODO[F11]: validar X-Hub-Signature-256 con APP_SECRET.
  // const signature = request.headers.get("x-hub-signature-256");
  // if (!verifyHmac(signature, await request.text(), process.env.WHATSAPP_APP_SECRET)) {
  //   return new NextResponse("invalid signature", { status: 403 });
  // }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;

      // Messages inbound → crear pedido (en F7 conectar con flow real)
      for (const msg of value.messages ?? []) {
        if (msg.type !== "text" || !msg.text?.body) continue;
        const contact = value.contacts?.find((c) => c.wa_id === msg.from);
        const nombre = contact?.profile?.name ?? msg.from;
        // TODO: resolver organization a partir del phone_number_id (lookup
        // en integration.meta_json.phone_number_id → organization_id) y
        // crear `pedido` con canal=WHATSAPP. Esto se implementa cuando
        // las primeras orgs tengan WhatsApp conectado.
        void nombre;
        void msg.text.body;
      }

      // Statuses outbound → marcar recordatorio_job como enviado o failed
      for (const status of value.statuses ?? []) {
        // TODO: lookup recordatorio_job por messages.id → setear enviado_ts
        // o incrementar intentos si failed.
        void status;
      }
    }
  }

  return NextResponse.json({ ok: true });
}

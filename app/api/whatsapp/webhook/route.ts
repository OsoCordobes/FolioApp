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
 *     read, failed). Actualizamos `recordatorio_job` (M18).
 *
 * Seguridad:
 *   - GET verify token (Meta lo manda en cada handshake).
 *   - POST: X-Hub-Signature-256 HMAC SHA256 del body con META_APP_SECRET.
 *     En modo dev (sin secret) → warn + accept. En prod sin secret → 503.
 */

import { NextResponse, type NextRequest } from "next/server";

import { encryptColumn } from "@/lib/crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveOrgByPhoneNumberId } from "@/lib/whatsapp/resolve-org";
import { verifyMetaSignature } from "@/lib/whatsapp/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "interactive";
  text?: { body: string };
}

interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

interface WhatsAppEntry {
  changes: Array<{
    value: {
      messaging_product: "whatsapp";
      metadata: { phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: WhatsAppMessage[];
      statuses?: WhatsAppStatus[];
    };
    field: "messages";
  }>;
}

const STATUS_MAP: Record<WhatsAppStatus["status"], "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function POST(request: NextRequest) {
  // 1. Validar firma. Leemos el body como texto para HMAC, luego parseamos.
  const rawBody = await request.text();
  const sigCheck = verifyMetaSignature(request.headers.get("x-hub-signature-256"), rawBody);
  if (!sigCheck.ok) {
    return new NextResponse(`signature ${sigCheck.reason}`, {
      status: sigCheck.reason === "server-misconfigured" ? 503 : 403,
    });
  }

  let payload: { entry?: WhatsAppEntry[] };
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.warn("[whatsapp] body no es JSON válido:", e);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const supabase = createSupabaseServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      const org = phoneNumberId ? await resolveOrgByPhoneNumberId(phoneNumberId) : null;

      // ─── Messages inbound ──────────────────────────────────────────────
      for (const msg of value.messages ?? []) {
        if (msg.type !== "text" || !msg.text?.body) continue;

        if (!org) {
          console.warn(`[whatsapp] mensaje recibido para phone_number_id=${phoneNumberId} pero no resolve a ninguna org. Ignorado.`);
          continue;
        }

        const contact = value.contacts?.find((c) => c.wa_id === msg.from);
        const nombre = contact?.profile?.name?.trim() || msg.from;
        const telefono = msg.from.startsWith("+") ? msg.from : `+${msg.from}`;
        const motivo = msg.text.body.slice(0, 2000);

        // Inserción de pedido vía service client (RLS bypass — el remitente
        // no tiene sesión user).
        const { error: pedErr } = await supabase.from("pedido").insert({
          organization_id: org.id,
          canal: "WHATSAPP",
          estado: "PENDIENTE",
          nombre_cifrado: encryptColumn(nombre)!,
          telefono_cifrado: encryptColumn(telefono)!,
          email_cifrado: null,
          fecha_propuesta: null,
          duracion_min: 45,
          servicio_id: null,
          motivo_cifrado: encryptColumn(motivo),
          precio_cents: null,
        });
        if (pedErr) {
          console.warn(`[whatsapp] error creando pedido inbound: ${pedErr.message}`);
        }
      }

      // ─── Statuses outbound (delivered/read/failed) ─────────────────────
      for (const status of value.statuses ?? []) {
        const dbStatus = STATUS_MAP[status.status];
        if (!dbStatus) continue;

        const patch: Record<string, unknown> = {
          estado_delivery: dbStatus,
          delivery_updated_ts: new Date(Number(status.timestamp) * 1000).toISOString(),
        };
        if (status.status === "failed" && status.errors?.[0]) {
          const e = status.errors[0];
          patch.error_msg = `${e.code}: ${e.title}${e.message ? ` — ${e.message}` : ""}`;
        }

        const { error: upErr } = await supabase
          .from("recordatorio_job")
          .update(patch)
          .eq("meta_message_id", status.id);
        if (upErr) {
          console.warn(`[whatsapp] error actualizando status ${status.id}: ${upErr.message}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

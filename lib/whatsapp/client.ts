/**
 * Folio · WhatsApp Business Cloud API client.
 *
 * Wrapper directo sobre la API REST de Meta (no usamos SDK oficial — la
 * superficie que necesitamos es chica: send template + webhook handling).
 *
 * Credenciales (Vercel env):
 *   - WHATSAPP_ACCESS_TOKEN          — system user token (long-lived)
 *   - WHATSAPP_PHONE_NUMBER_ID       — id del número Business
 *   - WHATSAPP_BUSINESS_ACCOUNT_ID   — id del WABA
 *   - WHATSAPP_WEBHOOK_VERIFY_TOKEN  — secret arbitrario para validar webhooks
 *
 * Sin credenciales configuradas, las funciones lanzan. F11 incluye fallback
 * a `wa.me` (deep link) cuando WA Cloud no esté disponible.
 */

const API_VERSION = "v22.0";                  // current GA de Meta WhatsApp Cloud API
const API_BASE = `https://graph.facebook.com/${API_VERSION}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} no configurada. Crear app de WhatsApp Business en developers.facebook.com y setear en .env.local.`,
    );
  }
  return v;
}

interface ApiError {
  code: number;
  message: string;
  type: string;
}

async function whatsappRequest<T>(path: string, body: unknown): Promise<T> {
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const url = `${API_BASE}/${phoneId}/${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: ApiError };
    throw new Error(
      `WhatsApp API ${res.status}: ${json.error?.message ?? "unknown"} (${json.error?.code ?? "?"})`,
    );
  }
  return (await res.json()) as T;
}

// ─── Send template message ─────────────────────────────────────────────

interface TemplateComponent {
  type: "body" | "header" | "button";
  parameters?: Array<
    | { type: "text"; text: string }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "date_time"; date_time: { fallback_value: string } }
  >;
  sub_type?: "url" | "quick_reply";
  index?: string;
}

interface SendTemplateInput {
  to: string;                                   // E.164: "5493516008942"
  templateName: string;                         // ej: "folio_confirmacion_v1"
  languageCode: string;                         // "es_AR"
  components?: TemplateComponent[];
}

interface SendTemplateResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status: string }>;
}

export async function sendTemplate(input: SendTemplateInput): Promise<{ id: string }> {
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      components: input.components ?? [],
    },
  };
  const res = await whatsappRequest<SendTemplateResponse>("messages", body);
  return { id: res.messages[0]?.id ?? "" };
}

// ─── Send text (free-form, requiere 24h window) ────────────────────────

interface SendTextInput {
  to: string;
  text: string;
  previewUrl?: boolean;
}

export async function sendText(input: SendTextInput): Promise<{ id: string }> {
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "text",
    text: { body: input.text, preview_url: input.previewUrl ?? false },
  };
  const res = await whatsappRequest<SendTemplateResponse>("messages", body);
  return { id: res.messages[0]?.id ?? "" };
}

// ─── Fallback wa.me deep link (sin Cloud API) ──────────────────────────

export function fallbackWaMeLink(phoneE164: string, message?: string): string {
  const phone = phoneE164.replace(/[^\d]/g, "");
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${phone}${text}`;
}

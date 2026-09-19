import "server-only";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  idempotencyKey?: string;
}
/** `sent` means provider acceptance only, never confirmed delivery. */
export type SendEmailResult =
  | { status: "sent"; providerId?: string }
  | { status: "simulated"; detail: string }
  | { status: "blocked" | "uncertain" | "queued"; detail: string }
  | { status: "failed"; detail: string; retryable?: boolean };
export interface EmailTransportConfig { enabled: boolean; apiKey?: string; from: string }
export type EmailTransport = (body: Record<string, unknown>, key?: string) => Promise<{ status: number; body: { id?: string; [key: string]: unknown } }>;

export function emailDeliveryConfiguration() {
  return {
    enabled: process.env.FOLIO_EMAIL_DELIVERY_ENABLED === "true",
    providerConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    quota: "pending_provider_and_auth_budget_verification" as const,
  };
}

/** Bounded server-side transport. Provider bodies, addresses and subjects never enter logs. */
export async function sendEmail(input: SendEmailInput, dependencies?: {
  config: EmailTransportConfig;
  transport: EmailTransport;
}): Promise<SendEmailResult> {
  const config = dependencies?.config ?? {
    enabled: process.env.FOLIO_EMAIL_DELIVERY_ENABLED === "true",
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM ?? "",
  };
  if (!config.enabled) return { status: "blocked", detail: "delivery_disabled" };
  if (!config.apiKey || !config.from) return { status: "blocked", detail: "provider_not_configured" };
  if (!input.idempotencyKey) return { status: "blocked", detail: "idempotency_key_required" };
  const transport: EmailTransport = dependencies?.transport ?? (async (body, key) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key! },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  try {
    const response = await transport({ from: config.from, to: input.to, subject: input.subject, html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}) }, input.idempotencyKey);
    if (response.status < 200 || response.status >= 300) {
      return { status: "failed", detail: `provider_http_${response.status}`, retryable: response.status === 429 || response.status >= 500 };
    }
    if (!response.body.id) return { status: "uncertain", detail: "provider_receipt_missing" };
    return { status: "sent", providerId: response.body.id };
  } catch {
    return { status: "uncertain", detail: "provider_response_unknown" };
  }
}

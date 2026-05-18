/**
 * Folio · PostHog server-side capture.
 *
 * El cliente browser está en lib/observability/posthog-client.ts. Acá
 * exponemos un helper para Server Actions / API routes que quieran tracker
 * eventos sin loop al cliente (ej. recordatorio enviado, factura emitida).
 *
 * Sin POSTHOG_KEY configurada, los calls son no-op para no romper el dev loop.
 */

import { PostHog } from "posthog-node";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host,
      flushAt: 1,                                       // server-side: flush por evento
      flushInterval: 0,
    });
  }
  return client;
}

export interface CaptureInput {
  distinctId: string;                                   // userId / orgId / sessionId
  event: string;                                        // 'turno.created' | 'factura.emitida' | etc.
  properties?: Record<string, unknown>;
}

export async function captureServerEvent(input: CaptureInput): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: input.distinctId,
    event: input.event,
    properties: {
      ...input.properties,
      $process_person_profile: false,                   // server-side, no crear perfil de usuario
    },
  });
}

/**
 * Folio · Google Calendar sync inbound (Google → Folio).
 *
 * Refleja los eventos ocupados del calendar del profesional como filas de
 * `bloqueo` (origen='google') para que el booking público y el chequeo de
 * slots los resten. Disparado por el webhook de watch (push notification);
 * el handshake inicial (resourceState='sync') también sincroniza, así el
 * primer estado llega apenas se (re)crea el watch channel.
 *
 * Estrategia: ventana completa idempotente (hoy → +30 días) en vez de
 * syncToken incremental. Una llamada a events.list por notificación; el
 * resultado se reconcilia contra los bloqueos google existentes (upsert por
 * gcal_event_id vía índice único M52 + delete de los que ya no están).
 *
 * Qué cuenta como "ocupado":
 *   - evento con hora (no de día completo — los all-day suelen ser
 *     cumpleaños/recordatorios y bloquearían días enteros),
 *   - transparency != 'transparent' ("Libre" en GCal no bloquea),
 *   - no cancelado,
 *   - NO creado por Folio (su id ya figura en turno.gcal_event_id — esos
 *     se restan como turnos; duplicarlos como bloqueo taparía reagendas).
 *
 * FAIL-SAFE igual que el push: los errores se reportan al caller para que
 * registre `ultimo_error`, pero nunca afectan turnos existentes.
 */

import { decryptColumn } from "@/lib/crypto";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

import { listEvents, type GoogleEvent } from "./calendar";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const INBOUND_WINDOW_DAYS = 30;

/** Límites de bloqueo.duracion_min (CHECK bloqueo_duracion_valid, M09). */
const MIN_DURACION_MIN = 5;
const MAX_DURACION_MIN = 1440;
const MAX_TITULO_LEN = 200;

export interface BloqueoGoogleRow {
  id: string;
  gcal_event_id: string | null;
  inicio: string;
  duracion_min: number;
  titulo: string | null;
}

export interface BloqueoUpsert {
  gcal_event_id: string;
  inicio: string;
  duracion_min: number;
  titulo: string | null;
}

export interface InboundSyncPlan {
  upserts: BloqueoUpsert[];
  deleteIds: string[];
}

/**
 * Decide qué bloqueos crear/actualizar/borrar (pura, testeable sin DB ni
 * Google). `existing` son los bloqueos origen='google' del profesional cuyo
 * inicio cae dentro de la ventana sincronizada.
 */
export function planInboundSync(input: {
  events: GoogleEvent[];
  existing: BloqueoGoogleRow[];
  folioEventIds: Set<string>;
  windowStartMs: number;
  windowEndMs: number;
}): InboundSyncPlan {
  const busy = new Map<string, BloqueoUpsert>();

  for (const ev of input.events) {
    if (!ev.id) continue;
    if (ev.status === "cancelled") continue;
    if (ev.allDay) continue;
    if (ev.transparency === "transparent") continue;
    if (input.folioEventIds.has(ev.id)) continue;

    const startMs = Date.parse(ev.start);
    const endMs = Date.parse(ev.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;
    // Solo eventos que arrancan dentro de la ventana: la disponibilidad
    // filtra bloqueos por inicio en rango (misma semántica que turnos).
    if (startMs < input.windowStartMs || startMs >= input.windowEndMs) continue;

    const duracion = Math.min(
      MAX_DURACION_MIN,
      Math.max(MIN_DURACION_MIN, Math.round((endMs - startMs) / 60_000)),
    );
    busy.set(ev.id, {
      gcal_event_id: ev.id,
      inicio: new Date(startMs).toISOString(),
      duracion_min: duracion,
      titulo: ev.summary ? ev.summary.slice(0, MAX_TITULO_LEN) : null,
    });
  }

  const existingByEventId = new Map<string, BloqueoGoogleRow>();
  for (const row of input.existing) {
    if (row.gcal_event_id) existingByEventId.set(row.gcal_event_id, row);
  }

  const upserts: BloqueoUpsert[] = [];
  for (const candidate of busy.values()) {
    const current = existingByEventId.get(candidate.gcal_event_id);
    const unchanged =
      current &&
      Date.parse(current.inicio) === Date.parse(candidate.inicio) &&
      current.duracion_min === candidate.duracion_min &&
      (current.titulo ?? null) === candidate.titulo;
    if (!unchanged) upserts.push(candidate);
  }

  const deleteIds = input.existing
    .filter((row) => row.gcal_event_id && !busy.has(row.gcal_event_id))
    .map((row) => row.id);

  return { upserts, deleteIds };
}

export interface IntegrationRow {
  id: string;
  organization_id: string;
  profesional_id: string;
  refresh_token_cifrado: string | null;
  meta_json: Record<string, unknown> | null;
}

export interface InboundSyncResult {
  ok: boolean;
  skipped?: "no_token";
  upserted: number;
  deleted: number;
}

/**
 * Sincroniza la ventana [ahora, ahora + 30d) del calendar del profesional
 * hacia `bloqueo`. Lanza ante errores de Google/DB (el caller decide cómo
 * registrarlos y qué responder al webhook).
 */
export async function syncGoogleInbound(
  service: ServiceClient,
  integration: IntegrationRow,
): Promise<InboundSyncResult> {
  const refreshToken = integration.refresh_token_cifrado
    ? decryptColumn(integration.refresh_token_cifrado)
    : null;
  if (!refreshToken) return { ok: true, skipped: "no_token", upserted: 0, deleted: 0 };

  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + INBOUND_WINDOW_DAYS * 24 * 60 * 60_000);
  const calendarId =
    (integration.meta_json?.calendar_id as string | undefined) || "primary";

  const events = await listEvents(
    refreshToken,
    windowStart.toISOString(),
    windowEnd.toISOString(),
    calendarId,
  );

  // Eventos creados por Folio (push outbound): se restan como turnos, no
  // duplicarlos como bloqueo.
  const { data: turnoRows, error: turnoErr } = await service
    .from("turno")
    .select("gcal_event_id")
    .eq("organization_id", integration.organization_id)
    .eq("profesional_id", integration.profesional_id)
    .not("gcal_event_id", "is", null)
    .gte("inicio", new Date(windowStart.getTime() - 24 * 60 * 60_000).toISOString());
  if (turnoErr) throw new Error(`turno query: ${turnoErr.message}`);
  const folioEventIds = new Set(
    ((turnoRows ?? []) as Array<{ gcal_event_id: string | null }>)
      .map((t) => t.gcal_event_id)
      .filter((id): id is string => Boolean(id)),
  );

  const { data: existingRows, error: existingErr } = await service
    .from("bloqueo")
    .select("id, gcal_event_id, inicio, duracion_min, titulo")
    .eq("organization_id", integration.organization_id)
    .eq("profesional_id", integration.profesional_id)
    .eq("origen", "google")
    .not("gcal_event_id", "is", null)
    .gte("inicio", windowStart.toISOString())
    .lt("inicio", windowEnd.toISOString());
  if (existingErr) throw new Error(`bloqueo query: ${existingErr.message}`);

  const plan = planInboundSync({
    events,
    existing: (existingRows ?? []) as BloqueoGoogleRow[],
    folioEventIds,
    windowStartMs: windowStart.getTime(),
    windowEndMs: windowEnd.getTime(),
  });

  if (plan.upserts.length > 0) {
    const { error: upsertErr } = await service.from("bloqueo").upsert(
      plan.upserts.map((u) => ({
        organization_id: integration.organization_id,
        profesional_id: integration.profesional_id,
        origen: "google",
        ...u,
      })),
      { onConflict: "organization_id,profesional_id,gcal_event_id" },
    );
    if (upsertErr) throw new Error(`bloqueo upsert: ${upsertErr.message}`);
  }

  if (plan.deleteIds.length > 0) {
    const { error: deleteErr } = await service
      .from("bloqueo")
      .delete()
      .in("id", plan.deleteIds);
    if (deleteErr) throw new Error(`bloqueo delete: ${deleteErr.message}`);
  }

  return { ok: true, upserted: plan.upserts.length, deleted: plan.deleteIds.length };
}

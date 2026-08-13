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
 *   - transparency != 'transparent' ("Libre" en GCal no bloquea) — es la
 *     única salida para un all-day que NO debería ocupar (cumpleaños,
 *     recordatorios): marcarlo "Libre" en Google,
 *   - no cancelado,
 *   - NO creado por Folio (su id ya figura en turno.gcal_event_id — esos
 *     se restan como turnos; duplicarlos como bloqueo taparía reagendas).
 *
 * Los eventos de DÍA COMPLETO sí cuentan (D1): así se marcan las vacaciones y
 * las ausencias en Google Calendar. Antes se descartaban en seco, con lo cual
 * el link público seguía ofreciendo turnos durante las vacaciones del médico
 * y —con auto_confirmar_reservas en true, el default— los confirmaba solo.
 *
 * Todo evento que cruza la medianoche local (all-day de varios días, o con
 * hora pero largo) se EXPANDE en un bloqueo por día vía
 * lib/agenda/bloqueo-rango.ts, en vez de truncarse en 1440' como antes: una
 * fila sola de un día tapaba el lunes y dejaba el resto de la semana abierto.
 * Cada tramo lleva la clave sintética `<eventId>#YYYY-MM-DD` para que el
 * upsert por (org, profesional, gcal_event_id) siga siendo idempotente y el
 * GC de tramos que ya no corresponden siga funcionando.
 *
 * FAIL-SAFE igual que el push: los errores se reportan al caller para que
 * registre `ultimo_error`, pero nunca afectan turnos existentes.
 */

import {
  fechaLocalEnTz,
  medianocheLocalUtcMs,
  partirRangoEnBloqueos,
  rangoDeDiasCompletos,
  sumarDiasIso,
  esFechaIso,
} from "@/lib/agenda/bloqueo-rango";
import { decryptColumn } from "@/lib/crypto";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

import { listEvents, type GoogleEvent } from "./calendar";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const INBOUND_WINDOW_DAYS = 30;

export const TZ_FALLBACK = "America/Argentina/Cordoba";

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

/** Clave del tramo N-ésimo de un evento que cruza la medianoche local. */
export function claveSegmento(eventId: string, fechaLocal: string): string {
  return `${eventId}#${fechaLocal}`;
}

/**
 * Rango [desde, hasta) en epoch ms que ocupa un evento de Google, o null si
 * las fechas no sirven.
 *
 * All-day: Google manda `start.date`/`end.date` como "YYYY-MM-DD" con el END
 * EXCLUSIVO (unas vacaciones del 20 al 22 llegan como start=20, end=23). Se
 * interpretan en la timezone de la organización — el bloqueo tiene que tapar
 * el día del consultorio, no el día UTC (que arrancaría a las 21:00 del día
 * anterior en Argentina).
 */
export function rangoDeEvento(
  ev: GoogleEvent,
  timeZone: string,
): { desdeMs: number; hastaMs: number } | null {
  if (ev.allDay) {
    if (!esFechaIso(ev.start)) return null;
    // end ausente/corrupto o <= start ⇒ un solo día (defensa: Google siempre
    // manda end, pero un all-day sin end no debe perderse ni explotar).
    const hastaInclusive =
      esFechaIso(ev.end) && ev.end > ev.start ? sumarDiasIso(ev.end, -1) : ev.start;
    return rangoDeDiasCompletos(ev.start, hastaInclusive, timeZone);
  }
  const desdeMs = Date.parse(ev.start);
  const hastaMs = Date.parse(ev.end);
  if (Number.isNaN(desdeMs) || Number.isNaN(hastaMs) || hastaMs <= desdeMs) return null;
  return { desdeMs, hastaMs };
}

/**
 * Decide qué bloqueos crear/actualizar/borrar (pura, testeable sin DB ni
 * Google). `existing` son los bloqueos origen='google' del profesional cuyo
 * inicio cae dentro de la ventana sincronizada.
 *
 * La ventana arranca en la medianoche local de HOY (no en "ahora"): un evento
 * en curso, o unas vacaciones que empezaron el lunes, tienen que seguir
 * ocupando el resto del día de hoy y los días que vienen.
 */
export function planInboundSync(input: {
  events: GoogleEvent[];
  existing: BloqueoGoogleRow[];
  folioEventIds: Set<string>;
  windowStartMs: number;
  windowEndMs: number;
  /** Timezone de la organización; define el corte de día de los all-day. */
  timeZone: string;
}): InboundSyncPlan {
  const busy = new Map<string, BloqueoUpsert>();
  const tz = input.timeZone || TZ_FALLBACK;

  for (const ev of input.events) {
    if (!ev.id) continue;
    if (ev.status === "cancelled") continue;
    if (ev.transparency === "transparent") continue;
    if (input.folioEventIds.has(ev.id)) continue;

    const rango = rangoDeEvento(ev, tz);
    if (!rango) continue;

    const titulo = ev.summary ? ev.summary.slice(0, MAX_TITULO_LEN) : null;
    // Un tramo por día local: nunca truncamos en 1440' (eso dejaba los días
    // 2..n de unas vacaciones abiertos a reserva).
    const segmentos = partirRangoEnBloqueos({ ...rango, timeZone: tz });
    const multiDia = segmentos.length > 1;

    for (const seg of segmentos) {
      // Solo tramos que arrancan dentro de la ventana: la disponibilidad y la
      // grilla filtran bloqueos por inicio en rango (misma semántica que
      // turnos), y el GC de abajo borra exactamente ese mismo universo.
      if (seg.inicioMs < input.windowStartMs || seg.inicioMs >= input.windowEndMs) continue;
      // Evento de un solo día ⇒ la clave sigue siendo el id crudo de Google
      // (cero churn sobre las filas que ya existen en prod).
      const clave = multiDia ? claveSegmento(ev.id, seg.fechaLocal) : ev.id;
      busy.set(clave, {
        gcal_event_id: clave,
        inicio: new Date(seg.inicioMs).toISOString(),
        duracion_min: seg.duracionMin,
        titulo,
      });
    }
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

/** Timezone de la org (fallback al default de M02 si la lectura falla). */
async function orgTimezone(service: ServiceClient, organizationId: string): Promise<string> {
  const { data, error } = await service
    .from("organization")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data?.timezone) return TZ_FALLBACK;
  return data.timezone as string;
}

/**
 * Sincroniza la ventana [medianoche de hoy, ahora + 30d) del calendar del
 * profesional hacia `bloqueo`. Lanza ante errores de Google/DB (el caller
 * decide cómo registrarlos y qué responder al webhook).
 *
 * La ventana arranca en la medianoche LOCAL de hoy, no en "ahora": con
 * timeMin=ahora, Google no devolvía los eventos que ya habían empezado y el
 * sync borraba su bloqueo — el slot de una consulta EN CURSO quedaba libre
 * para reservar. Y una ausencia de varios días que arrancó el lunes se
 * perdía entera el martes.
 */
export async function syncGoogleInbound(
  service: ServiceClient,
  integration: IntegrationRow,
): Promise<InboundSyncResult> {
  const refreshToken = integration.refresh_token_cifrado
    ? decryptColumn(integration.refresh_token_cifrado)
    : null;
  if (!refreshToken) return { ok: true, skipped: "no_token", upserted: 0, deleted: 0 };

  const timeZone = await orgTimezone(service, integration.organization_id);
  const ahora = new Date();
  const windowStart = new Date(
    medianocheLocalUtcMs(fechaLocalEnTz(ahora.getTime(), timeZone), timeZone),
  );
  const windowEnd = new Date(ahora.getTime() + INBOUND_WINDOW_DAYS * 24 * 60 * 60_000);
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
    timeZone,
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

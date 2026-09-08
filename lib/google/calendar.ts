/**
 * Folio · Google Calendar API wrapper.
 *
 * Sync bidireccional:
 *   - App → Google: al CONFIRMAR un turno, crear evento en el calendar
 *     del profesional. Al CANCELAR/REAGENDAR, update/delete.
 *   - Google → App: webhook (watch channel) avisa cambios → re-fetch lista
 *     incremental y aplicar a `bloqueo` (eventos personales) y/o `turno`
 *     (si el evento fue creado por la app, ya tiene gcal_event_id).
 *
 * Sin la integración real configurada en Google Cloud Console, las funciones
 * lanzan al primer uso. F11 polish incluye flow de "Reconectar" si los
 * tokens revocan.
 */

import { google } from "googleapis";

import { makeOAuth2Client } from "./oauth";

export interface GoogleEvent {
  id: string;
  summary?: string | null;
  description?: string | null;
  start: string;                                  // ISO datetime
  end: string;
  status?: "confirmed" | "tentative" | "cancelled";
  attendees?: { email: string; responseStatus?: string }[];
  /** 'transparent' = el evento NO bloquea agenda ("Libre" en GCal). */
  transparency?: "opaque" | "transparent" | null;
  /** true si es evento de día completo (start.date sin dateTime). */
  allDay: boolean;
}

function clientFor(refreshToken: string, signal?: AbortSignal) {
  const auth = makeOAuth2Client(refreshToken, signal);
  return google.calendar({ version: "v3", auth });
}

// ─── Listar eventos del primario en rango ──────────────────────────────

export function googleRequestOptions(signal?: AbortSignal) {
  return { timeout: 15_000, retry: false, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) };
}

export async function listEvents(refreshToken: string, timeMin: string, timeMax: string, calendarId = "primary", signal?: AbortSignal): Promise<GoogleEvent[]> {
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000);
  const cal = clientFor(refreshToken, deadline);
  const events = new Map<string, GoogleEvent>();
  const seen = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 200; page++) {
    deadline.throwIfAborted();
    const res = await cal.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 250, pageToken }, googleRequestOptions(deadline));
    if (!res.data || res.data.kind!=="calendar#events" || typeof res.data.etag!=="string" || !res.data.etag || (res.data.items !== undefined && !Array.isArray(res.data.items))) throw new Error("google_snapshot_invalid");
    for (const e of res.data.items ?? []) {
      if (!e.id || typeof e.id !== "string") throw new Error("google_snapshot_invalid");
      const start = e.start?.dateTime ?? e.start?.date ?? "";
      const end = e.end?.dateTime ?? e.end?.date ?? "";
      const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
      if(e.status!=="cancelled"&&!e.start?.dateTime&&(!validDate(start)||!validDate(end)))throw new Error("google_snapshot_invalid");
      const validDateTime=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&validDate(value.slice(0,10));
      if(e.status!=="cancelled"&&e.start?.dateTime&&(!validDateTime(start)||!validDateTime(end)))throw new Error("google_snapshot_invalid");
      if (e.status !== "cancelled" && (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start))) throw new Error("google_snapshot_invalid");
      if (events.has(e.id)) throw new Error("google_snapshot_duplicate_id");
      events.set(e.id, { id:e.id, summary:e.summary, description:e.description, start,end,status:e.status as GoogleEvent["status"],attendees:e.attendees as GoogleEvent["attendees"],transparency:e.transparency as GoogleEvent["transparency"],allDay:!e.start?.dateTime });
    }
    const next = res.data.nextPageToken;
    if (next===undefined || next===null || next==="") {
      if(typeof res.data.nextSyncToken!=="string"||!res.data.nextSyncToken)throw new Error("google_snapshot_incomplete");
      return [...events.values()];
    }
    if (typeof next !== "string" || seen.has(next)) throw new Error("google_pagination_invalid");
    seen.add(next); pageToken = next;
  }
  throw new Error("google_snapshot_limit");
}

// ─── Crear evento al confirmar turno ──────────────────────────────────

export async function createEvent(
  refreshToken: string,
  payload: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    location?: string;
    attendeeEmail?: string;
    timeZone?: string;
  },
  calendarId = "primary",
  stableId?: string,
  signal?: AbortSignal,
): Promise<string> {
  const cal = clientFor(refreshToken, signal);
  const timeZone = payload.timeZone ?? "America/Argentina/Cordoba";
  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      id: stableId,
      extendedProperties: stableId ? { private: { folio_operation: stableId } } : undefined,
      summary: payload.summary,
      description: payload.description,
      start: { dateTime: payload.start, timeZone },
      end: { dateTime: payload.end, timeZone },
      location: payload.location,
      attendees: payload.attendeeEmail ? [{ email: payload.attendeeEmail }] : undefined,
      reminders: { useDefault: true },
    },
    sendUpdates: "none",
  }, googleRequestOptions(signal));
  if (!res.data.id) throw new Error("google_event_id_missing");
  return res.data.id;
}

// ─── Update / delete (mover, cancelar) ────────────────────────────────

export async function updateEvent(
  refreshToken: string,
  eventId: string,
  patch: {
    start?: string;
    end?: string;
    summary?: string;
    status?: "confirmed" | "cancelled";
    description?: string;
    timeZone?: string;
  },
  calendarId = "primary",
  signal?: AbortSignal,
  expectedEtag?: string,
) {
  const cal = clientFor(refreshToken, signal);
  const timeZone = patch.timeZone ?? "America/Argentina/Cordoba";
  await cal.events.patch({
    calendarId,
    eventId,
    sendUpdates: "none",
    requestBody: {
      ...(patch.description ? { description: patch.description } : {}),
      ...(patch.summary ? { summary: patch.summary } : {}),
      ...(patch.start ? { start: { dateTime: patch.start, timeZone } } : {}),
      ...(patch.end ? { end: { dateTime: patch.end, timeZone } } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  }, { ...googleRequestOptions(signal), ...(expectedEtag ? { headers: { "If-Match": expectedEtag } } : {}) });
}

export async function deleteEvent(
  refreshToken: string,
  eventId: string,
  calendarId = "primary",
  signal?: AbortSignal,
) {
  const cal = clientFor(refreshToken, signal);
  await cal.events.delete({ calendarId, eventId }, googleRequestOptions(signal));
}

// ─── Watch channel (push notifications) ────────────────────────────────

export async function startWatchChannel(
  refreshToken: string,
  channelId: string,
  webhookUrl: string,
  calendarId = "primary",
  channelToken?: string,
  signal?: AbortSignal,
): Promise<{ resourceId: string; expiration: string }> {
  const cal = clientFor(refreshToken, signal);
  const res = await cal.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      token: channelToken,
      type: "web_hook",
      address: webhookUrl,
      // Google requiere HTTPS para webhooks; en dev usar ngrok tunnel
      // (documentar en F11 deployment guide).
    },
  }, googleRequestOptions(signal));
  if (!res.data.resourceId) throw new Error("google_watch_resource_missing");
  return {
    resourceId: res.data.resourceId!,
    expiration: res.data.expiration ?? "",
  };
}

export async function stopWatchChannel(
  refreshToken: string,
  channelId: string,
  resourceId: string,
  signal?: AbortSignal,
) {
  const auth = makeOAuth2Client(refreshToken, signal);
  const cal = google.calendar({ version: "v3", auth });
  await cal.channels.stop({
    requestBody: { id: channelId, resourceId },
  }, googleRequestOptions(signal));
}

export async function getEvent(refreshToken:string,eventId:string,calendarId="primary",signal?:AbortSignal) {
  return (await clientFor(refreshToken,signal).events.get({calendarId,eventId},googleRequestOptions(signal))).data;
}

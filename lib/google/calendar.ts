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
}

function clientFor(refreshToken: string) {
  const auth = makeOAuth2Client(refreshToken);
  return google.calendar({ version: "v3", auth });
}

// ─── Listar eventos del primario en rango ──────────────────────────────

export async function listEvents(
  refreshToken: string,
  timeMin: string,
  timeMax: string,
  calendarId = "primary",
): Promise<GoogleEvent[]> {
  const cal = clientFor(refreshToken);
  const res = await cal.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id!,
    summary: e.summary,
    description: e.description,
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    status: e.status as GoogleEvent["status"],
    attendees: e.attendees as GoogleEvent["attendees"],
  }));
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
  },
  calendarId = "primary",
): Promise<string> {
  const cal = clientFor(refreshToken);
  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: payload.summary,
      description: payload.description,
      start: { dateTime: payload.start, timeZone: "America/Argentina/Cordoba" },
      end: { dateTime: payload.end, timeZone: "America/Argentina/Cordoba" },
      location: payload.location,
      attendees: payload.attendeeEmail ? [{ email: payload.attendeeEmail }] : undefined,
      reminders: { useDefault: true },
    },
  });
  return res.data.id!;
}

// ─── Update / delete (mover, cancelar) ────────────────────────────────

export async function updateEvent(
  refreshToken: string,
  eventId: string,
  patch: { start?: string; end?: string; summary?: string; status?: "confirmed" | "cancelled" },
  calendarId = "primary",
) {
  const cal = clientFor(refreshToken);
  await cal.events.patch({
    calendarId,
    eventId,
    requestBody: {
      ...(patch.summary ? { summary: patch.summary } : {}),
      ...(patch.start ? { start: { dateTime: patch.start, timeZone: "America/Argentina/Cordoba" } } : {}),
      ...(patch.end ? { end: { dateTime: patch.end, timeZone: "America/Argentina/Cordoba" } } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  });
}

export async function deleteEvent(
  refreshToken: string,
  eventId: string,
  calendarId = "primary",
) {
  const cal = clientFor(refreshToken);
  await cal.events.delete({ calendarId, eventId });
}

// ─── Watch channel (push notifications) ────────────────────────────────

export async function startWatchChannel(
  refreshToken: string,
  channelId: string,
  webhookUrl: string,
  calendarId = "primary",
): Promise<{ resourceId: string; expiration: string }> {
  const cal = clientFor(refreshToken);
  const res = await cal.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      // Google requiere HTTPS para webhooks; en dev usar ngrok tunnel
      // (documentar en F11 deployment guide).
    },
  });
  return {
    resourceId: res.data.resourceId!,
    expiration: res.data.expiration ?? "",
  };
}

export async function stopWatchChannel(
  refreshToken: string,
  channelId: string,
  resourceId: string,
) {
  const auth = makeOAuth2Client(refreshToken);
  const cal = google.calendar({ version: "v3", auth });
  await cal.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

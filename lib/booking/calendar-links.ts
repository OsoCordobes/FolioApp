/**
 * Folio · builders de "agregar al calendario" (Google Calendar + .ics).
 *
 * Funciones PURAS (sin DB, sin env, sin Date.now) → testeables con fechas
 * inyectadas. Se usan en dos lados:
 *
 *   - Client (booking-wizard, vista "ok"): link a Google Calendar + descarga
 *     de un .ics generado en el browser vía data-URI. Cero backend.
 *   - Server (lib/email/notify.ts): el email de confirmación incluye el link
 *     de Google Calendar.
 *
 * Las fechas van SIEMPRE en UTC básico de iCalendar (`YYYYMMDDTHHMMSSZ`):
 * Google Calendar y los clientes .ics las convierten solos a la timezone del
 * calendario del paciente, así no dependemos de ICU ni de la TZ del runtime.
 */

export interface CalendarEventInput {
  /** ISO 8601 del inicio del turno (ej. slot.inicio / turno.inicio). */
  inicioIso: string;
  /** ISO 8601 del fin del turno (slot.fin, o inicio + duración). */
  finIso: string;
  /** Título del evento, texto plano (ej. "Consulta inicial · Consultorio X"). */
  titulo: string;
  /** Dirección física del consultorio (organization.direccion_completa). */
  ubicacion?: string | null;
  /** Descripción opcional, texto plano. */
  descripcion?: string | null;
}

/** ISO 8601 → formato iCalendar UTC básico: "2026-06-10T13:00:00.000Z" → "20260610T130000Z". */
export function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Suma minutos a un ISO y devuelve ISO UTC (para computar DTEND desde duracion_min). */
export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/**
 * URL de "agregar a Google Calendar" (render?action=TEMPLATE).
 * El encoding lo hace URLSearchParams (espacios como '+', que GCal acepta).
 */
export function buildGoogleCalendarUrl(ev: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.titulo,
    dates: `${toIcsUtc(ev.inicioIso)}/${toIcsUtc(ev.finIso)}`,
  });
  if (ev.ubicacion) params.set("location", ev.ubicacion);
  if (ev.descripcion) params.set("details", ev.descripcion);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapado de valores TEXT de iCalendar (RFC 5545 §3.3.11): \ ; , y saltos de línea. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Contenido de un archivo .ics con un único VEVENT. Líneas CRLF (RFC 5545).
 * `dtstampIso`/`uid` son inyectables para que el output sea determinístico
 * (sin Date.now); por defecto derivan del propio evento.
 *
 * Nota: no plegamos líneas a 75 octetos (RFC 5545 §3.1) — los clientes
 * modernos (Google, Apple, Outlook) aceptan líneas largas sin plegar y los
 * campos acá son cortos (título/dirección de consultorio).
 */
export function buildIcsContent(
  ev: CalendarEventInput & { uid?: string; dtstampIso?: string },
): string {
  const dtStart = toIcsUtc(ev.inicioIso);
  const dtEnd = toIcsUtc(ev.finIso);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Folio//Turnos//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsEscape(ev.uid ?? `${dtStart}-${dtEnd}@folio`)}`,
    `DTSTAMP:${toIcsUtc(ev.dtstampIso ?? ev.inicioIso)}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(ev.titulo)}`,
    ...(ev.ubicacion ? [`LOCATION:${icsEscape(ev.ubicacion)}`] : []),
    ...(ev.descripcion ? [`DESCRIPTION:${icsEscape(ev.descripcion)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** data-URI para descargar el .ics client-side sin backend. */
export function buildIcsDataUri(icsContent: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;
}

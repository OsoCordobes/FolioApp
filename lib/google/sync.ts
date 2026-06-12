/**
 * Folio · Google Calendar sync (push Folio → Google).
 *
 * Único sentido: cuando un turno se crea/confirma en Folio, lo empujamos como
 * evento al Google Calendar del profesional dueño. NO hacemos pull Google →
 * Folio acá.
 *
 * Principio de diseño: FAIL-SAFE. La integración con Google es un "nice to
 * have"; jamás debe romper la creación de un turno. Toda la lógica de push va
 * envuelta en try/catch + captureException y nunca re-lanza. Si la integración
 * no existe, no está conectada, o la API de Google falla, el turno queda
 * creado igual (simplemente sin `gcal_event_id`).
 */

import { decryptColumn } from "@/lib/crypto";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { createEvent, updateEvent } from "./calendar";
import { INVALID_GRANT_MARKER, isInvalidGrantError } from "./health";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const DEFAULT_TZ = "America/Argentina/Cordoba";

/**
 * Best-effort: si el error de Google es invalid_grant (refresh token
 * revocado → integración MUERTA hasta re-OAuth), persistir la marca en
 * `integration.ultimo_error` para que la UI (banner de /hoy, estado
 * "Reconectar" en /configuracion) pueda enterarse. Usa service client porque
 * el caller puede ser un rol sin permiso de UPDATE sobre `integration`
 * (RLS integration_write_admin: OWNER o el propio profesional).
 *
 * Nunca lanza: la marca es telemetría — jamás rompe el flujo del turno.
 */
async function marcarInvalidGrantBestEffort(
  e: unknown,
  organizationId: string,
  profesionalMemberId: string,
): Promise<void> {
  if (!isInvalidGrantError(e)) return;
  try {
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    const service = createSupabaseServiceClient();
    const msg = e instanceof Error ? e.message : String(e);
    await service
      .from("integration")
      .update({
        ultimo_error: `${INVALID_GRANT_MARKER}: ${msg}`.slice(0, 500),
        ultimo_error_ts: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("profesional_id", profesionalMemberId)
      .eq("proveedor", "GOOGLE_CALENDAR");
  } catch {
    // ignore — el push ya reportó a Sentry; la marca es nice-to-have.
  }
}

// ─── Payload puro (testeable sin DB ni Google) ─────────────────────────────

export function buildCalendarEventPayload(input: {
  organizationNombre: string;
  servicioNombre: string;
  pacienteNombre: string;
  inicioIso: string;
  finIso: string;
  organizationTimezone: string | null;
  organizationDireccion: string | null;
  pacienteEmail: string | null;
}): {
  summary: string;
  description: string;
  start: string;
  end: string;
  location?: string;
  attendeeEmail?: string;
  timeZone: string;
} {
  const summary = `${input.servicioNombre} — ${input.pacienteNombre}`;
  const description = `${input.organizationNombre}\n\nReservado vía Folio.`;
  const payload: {
    summary: string;
    description: string;
    start: string;
    end: string;
    location?: string;
    attendeeEmail?: string;
    timeZone: string;
  } = {
    summary,
    description,
    start: input.inicioIso,
    end: input.finIso,
    timeZone: input.organizationTimezone || DEFAULT_TZ,
  };
  if (input.organizationDireccion) payload.location = input.organizationDireccion;
  if (input.pacienteEmail) payload.attendeeEmail = input.pacienteEmail;
  return payload;
}

// ─── Push: crear evento en Google al confirmar un turno ────────────────────

export async function pushTurnoToGoogle(input: {
  client: ServerClient;
  turnoId: string;
  organizationId: string;
  profesionalMemberId: string;
}): Promise<void> {
  const { client, turnoId, organizationId, profesionalMemberId } = input;
  try {
    // a. Turno (org-scoped).
    const { data: turno } = await client
      .from("turno")
      .select("inicio, duracion_min, gcal_event_id, paciente_id, servicio_id, estado")
      .eq("id", turnoId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!turno) return;

    // b. Idempotencia: si ya tiene evento, no re-pushear.
    if (turno.gcal_event_id) return;

    // c. Integración Google del profesional. No-op si no conectado.
    const { data: integration } = await client
      .from("integration")
      .select("refresh_token_cifrado, meta_json")
      .eq("organization_id", organizationId)
      .eq("profesional_id", profesionalMemberId)
      .eq("proveedor", "GOOGLE_CALENDAR")
      .maybeSingle();
    if (!integration || !integration.refresh_token_cifrado) return;

    // d. Descifrar refresh token.
    const refreshToken = decryptColumn(integration.refresh_token_cifrado);
    if (!refreshToken) return;

    // e. Datos para el evento: org + servicio + paciente.
    const [{ data: org }, { data: servicio }, { data: paciente }] = await Promise.all([
      client
        .from("organization")
        .select("nombre, timezone, direccion_completa")
        .eq("id", organizationId)
        .maybeSingle(),
      client
        .from("servicio")
        .select("nombre")
        .eq("id", turno.servicio_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
      client
        .from("paciente")
        .select("identidad_id")
        .eq("id", turno.paciente_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);

    let pacienteNombre = "Paciente";
    let pacienteEmail: string | null = null;
    if (paciente?.identidad_id) {
      const { data: identidad } = await client
        .from("paciente_identidad")
        .select("nombre_cifrado, apellido_cifrado, email_cifrado")
        .eq("id", paciente.identidad_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (identidad) {
        const nombre = decryptColumn(identidad.nombre_cifrado) ?? "";
        const apellido = decryptColumn(identidad.apellido_cifrado) ?? "";
        const full = `${nombre} ${apellido}`.trim();
        if (full) pacienteNombre = full;
        pacienteEmail = decryptColumn(identidad.email_cifrado);
      }
    }

    // f. Calcular fin.
    const finIso = new Date(
      new Date(turno.inicio).getTime() + turno.duracion_min * 60_000,
    ).toISOString();

    // g. Construir payload + crear evento.
    const payload = buildCalendarEventPayload({
      organizationNombre: org?.nombre ?? "Folio",
      servicioNombre: servicio?.nombre ?? "Turno",
      pacienteNombre,
      inicioIso: new Date(turno.inicio).toISOString(),
      finIso,
      organizationTimezone: org?.timezone ?? null,
      organizationDireccion: org?.direccion_completa ?? null,
      pacienteEmail,
    });

    const calendarId = (integration.meta_json?.calendar_id as string | undefined) || "primary";
    const eventId = await createEvent(refreshToken, payload, calendarId);

    // h. Persistir el event id (idempotencia futura).
    await client
      .from("turno")
      .update({ gcal_event_id: eventId })
      .eq("id", turnoId)
      .eq("organization_id", organizationId);

    // i. Best-effort: marcar último uso de la integración.
    try {
      await client
        .from("integration")
        .update({ ultimo_uso_ts: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("profesional_id", profesionalMemberId)
        .eq("proveedor", "GOOGLE_CALENDAR");
    } catch {
      // ignore — telemetría, no crítico.
    }
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "gcal-sync", op: "pushTurnoToGoogle" },
      extra: { turnoId, organizationId, profesionalMemberId },
    });
    await marcarInvalidGrantBestEffort(e, organizationId, profesionalMemberId);
  }
}

// ─── Cancelar: marcar el evento como cancelado en Google ───────────────────

export async function cancelTurnoEnGoogle(input: {
  client: ServerClient;
  turnoId: string;
  organizationId: string;
  profesionalMemberId: string;
}): Promise<void> {
  const { client, turnoId, organizationId, profesionalMemberId } = input;
  try {
    const { data: turno } = await client
      .from("turno")
      .select("gcal_event_id")
      .eq("id", turnoId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!turno || !turno.gcal_event_id) return;

    const { data: integration } = await client
      .from("integration")
      .select("refresh_token_cifrado, meta_json")
      .eq("organization_id", organizationId)
      .eq("profesional_id", profesionalMemberId)
      .eq("proveedor", "GOOGLE_CALENDAR")
      .maybeSingle();
    if (!integration || !integration.refresh_token_cifrado) return;

    const refreshToken = decryptColumn(integration.refresh_token_cifrado);
    if (!refreshToken) return;

    const calendarId = (integration.meta_json?.calendar_id as string | undefined) || "primary";
    await updateEvent(refreshToken, turno.gcal_event_id, { status: "cancelled" }, calendarId);
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "gcal-sync", op: "cancelTurnoEnGoogle" },
      extra: { turnoId, organizationId, profesionalMemberId },
    });
    await marcarInvalidGrantBestEffort(e, organizationId, profesionalMemberId);
  }
}

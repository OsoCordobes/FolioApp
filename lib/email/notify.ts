/**
 * Folio · orquestación fail-safe de emails de booking.
 *
 * Mismo principio que lib/google/sync.ts: enviar un email JAMÁS rompe una
 * reserva. Cada función envuelve todo en try/catch + captureException y nunca
 * re-lanza. Si falta el email del paciente, se devuelve sin hacer nada.
 *
 * El `fechaHoraLabel` se computa acá (no en los templates puros) con
 * Intl.DateTimeFormat en la timezone de la org, para que los templates queden
 * testeables sin dependencia de entorno.
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { sendEmail } from "./client";
import { buildBookingConfirmadaEmail } from "./templates/booking-confirmada";
import { buildBookingRecibidaEmail } from "./templates/booking-recibida";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const DEFAULT_TZ = "America/Argentina/Cordoba";

function formatFechaHora(inicioIso: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone || DEFAULT_TZ,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(inicioIso));
  } catch {
    // timezone inválida o fecha mala → fallback sin tz.
    return new Date(inicioIso).toISOString();
  }
}

// ─── Confirmada: turno ya creado (auto-confirm o aceptarPedido) ────────────

export async function notifyBookingConfirmada(input: {
  client: ServerClient;
  turnoId: string;
  organizationId: string;
  pacienteEmail: string | null;
  pacienteNombre: string;
}): Promise<void> {
  const { client, turnoId, organizationId, pacienteEmail, pacienteNombre } = input;
  if (!pacienteEmail) return;

  try {
    const { data: org } = await client
      .from("organization")
      .select("nombre, timezone, direccion_completa")
      .eq("id", organizationId)
      .maybeSingle();

    const { data: turno } = await client
      .from("turno")
      .select("inicio, duracion_min, servicio_id")
      .eq("id", turnoId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!turno) return;

    const { data: servicio } = await client
      .from("servicio")
      .select("nombre")
      .eq("id", turno.servicio_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const fechaHoraLabel = formatFechaHora(turno.inicio, org?.timezone ?? null);

    const { subject, html } = buildBookingConfirmadaEmail({
      pacienteNombre,
      organizationNombre: org?.nombre ?? "Folio",
      servicioNombre: servicio?.nombre ?? "Turno",
      fechaHoraLabel,
      direccion: org?.direccion_completa ?? null,
    });

    await sendEmail({ to: pacienteEmail, subject, html });
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "email", op: "notifyBookingConfirmada" },
      extra: { turnoId, organizationId },
    });
  }
}

// ─── Recibida: pedido PENDIENTE (auto-confirm off o falló) ─────────────────

export async function notifyBookingRecibida(input: {
  client: ServerClient;
  organizationId: string;
  pacienteEmail: string | null;
  pacienteNombre: string;
  servicioNombre: string;
  inicioIso: string;
}): Promise<void> {
  const { client, organizationId, pacienteEmail, pacienteNombre, servicioNombre, inicioIso } =
    input;
  if (!pacienteEmail) return;

  try {
    const { data: org } = await client
      .from("organization")
      .select("nombre, timezone, direccion_completa")
      .eq("id", organizationId)
      .maybeSingle();

    const fechaHoraLabel = formatFechaHora(inicioIso, org?.timezone ?? null);

    const { subject, html } = buildBookingRecibidaEmail({
      pacienteNombre,
      organizationNombre: org?.nombre ?? "Folio",
      servicioNombre,
      fechaHoraLabel,
      direccion: org?.direccion_completa ?? null,
    });

    await sendEmail({ to: pacienteEmail, subject, html });
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "email", op: "notifyBookingRecibida" },
      extra: { organizationId },
    });
  }
}

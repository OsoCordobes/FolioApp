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

import { getAppUrl } from "@/lib/config/app-url";
import {
  createSupabaseServiceClient,
  type createSupabaseServerClient,
} from "@/lib/supabase/server";
import { SUPPORT_EMAIL } from "@/lib/support";

import { sendEmail } from "./client";
import { buildBookingConfirmadaEmail } from "./templates/booking-confirmada";
import { buildBookingRecibidaEmail } from "./templates/booking-recibida";
import { buildMemberInvitationEmail } from "./templates/member-invitation";
import { buildPedidoNuevoEmail, canalPedidoLabel } from "./templates/pedido-nuevo";

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

// ─── Invitación de equipo (M49/M51 · Fase C) ───────────────────────────────

/**
 * Envía el email de invitación al equipo. Fail-safe como el resto del módulo:
 * si Resend no está configurado o falla, NO rompe la creación de la
 * invitación — la UI de /configuracion siempre muestra el link para copiar,
 * así que la invitación nunca se pierde. El `acceptUrl` contiene el token
 * crudo: jamás loguearlo (acá solo viaja al proveedor de email).
 */
export async function notifyMemberInvitation(input: {
  to: string;
  organizationNombre: string;
  rolLabel: string;
  invitadoPorNombre: string | null;
  acceptUrl: string;
  expiresAtIso: string;
  timezone: string | null;
}): Promise<void> {
  try {
    const expiraLabel = new Intl.DateTimeFormat("es-AR", {
      timeZone: input.timezone || DEFAULT_TZ,
      dateStyle: "long",
    }).format(new Date(input.expiresAtIso));

    const { subject, html } = buildMemberInvitationEmail({
      organizationNombre: input.organizationNombre,
      rolLabel: input.rolLabel,
      invitadoPorNombre: input.invitadoPorNombre,
      acceptUrl: input.acceptUrl,
      expiraLabel,
    });

    // Reply-To soporte: el email lo recibe un profesional; si responde con
    // dudas, debe llegar a Folio (los emails a pacientes no llevan replyTo).
    await sendEmail({ to: input.to, subject, html, replyTo: SUPPORT_EMAIL });
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "email", op: "notifyMemberInvitation" },
      // NO incluir acceptUrl en extra: contiene el token crudo.
      extra: { to: input.to },
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

// ─── Pedido nuevo: aviso al profesional (bandeja de pedidos) ────────────────

/**
 * Avisa al PROFESIONAL que entró un pedido de turno que quedó PENDIENTE.
 * Callers: webhook de WhatsApp (siempre) y booking público (solo cuando NO
 * hubo auto-confirmación — si el pedido se convirtió en turno, el flujo de
 * confirmación ya cubre el aviso).
 *
 * Destinatario: el profesional destino del pedido (pedido.profesional_id →
 * member → profile.email) o, sin profesional asignado, el OWNER de la org.
 * La lectura de `member` usa el client del caller (ambos call sites pasan el
 * SERVICE client — no hay sesión en webhook/booking); la de `profile` va por
 * service client ANGOSTO (profile_select_self impide leer profiles ajenos
 * vía RLS — mismo patrón que listMembers en lib/db/members.ts).
 *
 * PHI mínima deliberada: nombre del solicitante y canal — sin motivo/notas
 * clínicas ni contacto del paciente. Fail-safe como el resto del módulo:
 * try/catch + captureException, jamás re-lanza ni rompe la creación del
 * pedido. Sin destinatario resoluble → return silencioso.
 */
export async function notifyPedidoNuevo(input: {
  client: ServerClient;
  organizationId: string;
  pedidoId: string;
  pacienteNombre: string;
  /** canal_pedido crudo de DB: WEB | WHATSAPP | INSTAGRAM | TELEFONO. */
  canal: string;
  /** fecha_propuesta ISO, o null (WhatsApp: pedido sin horario). */
  fechaPropuestaIso: string | null;
  /** member.id destino si el pedido lo trae; null → owner de la org. */
  profesionalId?: string | null;
}): Promise<void> {
  const { client, organizationId, pedidoId, pacienteNombre, canal, fechaPropuestaIso } = input;

  try {
    // 1. Resolver el profile destinatario: profesional del pedido, o OWNER.
    let profileId: string | null = null;
    if (input.profesionalId) {
      const { data: prof } = await client
        .from("member")
        .select("profile_id")
        .eq("id", input.profesionalId)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      profileId = (prof?.profile_id as string | undefined) ?? null;
    }
    if (!profileId) {
      const { data: owner } = await client
        .from("member")
        .select("profile_id")
        .eq("organization_id", organizationId)
        .eq("role", "OWNER")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      profileId = (owner?.profile_id as string | undefined) ?? null;
    }
    if (!profileId) return;

    // 2. Email del profile — lectura angosta vía service client (ver doc).
    const service = createSupabaseServiceClient();
    const { data: profile } = await service
      .from("profile")
      .select("email")
      .eq("id", profileId)
      .maybeSingle();
    const to = (profile?.email as string | undefined) ?? null;
    if (!to) return;

    // 3. Datos de display + template puro.
    const { data: org } = await client
      .from("organization")
      .select("nombre, timezone")
      .eq("id", organizationId)
      .maybeSingle();

    const { subject, html } = buildPedidoNuevoEmail({
      organizationNombre: org?.nombre ?? "Folio",
      pacienteNombre,
      canalLabel: canalPedidoLabel(canal),
      fechaHoraLabel: fechaPropuestaIso
        ? formatFechaHora(fechaPropuestaIso, org?.timezone ?? null)
        : null,
      calendarioUrl: `${getAppUrl()}/calendario`,
    });

    // Reply-To soporte: el destinatario es un profesional (mismo criterio que
    // notifyMemberInvitation — los emails a pacientes no llevan replyTo).
    await sendEmail({ to, subject, html, replyTo: SUPPORT_EMAIL });
  } catch (e) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "email", op: "notifyPedidoNuevo" },
      extra: { pedidoId, organizationId },
    });
  }
}

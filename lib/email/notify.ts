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

import type { TrialUmbralDias } from "@/lib/billing/lifecycle";
import { addMinutesIso, buildGoogleCalendarUrl } from "@/lib/booking/calendar-links";
import { getAppUrl } from "@/lib/config/app-url";

import { BILLING_RECOVERY_PATH } from "@/lib/db/suscripcion";
import {
  createSupabaseServiceClient,
  type createSupabaseServerClient,
} from "@/lib/supabase/server";
import { SUPPORT_EMAIL } from "@/lib/support";

import type { SendEmailResult } from "./client";
import { deliverDurableEmail } from "./durable";
import { esc } from "./templates/billing-common";
import { buildBookingConfirmadaEmail } from "./templates/booking-confirmada";
import { tryDecrypt } from "@/lib/crypto";
import { buildBookingRecibidaEmail } from "./templates/booking-recibida";
import { buildMemberInvitationEmail } from "./templates/member-invitation";
import { buildPagoFallidoEmail } from "./templates/pago-fallido";
import { buildPedidoNuevoEmail, canalPedidoLabel } from "./templates/pedido-nuevo";
import { buildSuscripcionActivadaEmail } from "./templates/suscripcion-activada";
import { buildSuscripcionCanceladaMorosidadEmail } from "./templates/suscripcion-cancelada-morosidad";
import { buildSuscripcionReactivadaEmail } from "./templates/suscripcion-reactivada";
import { buildSuscripcionSuspendidaEmail } from "./templates/suscripcion-suspendida";
import { buildTrialPorVencerEmail } from "./templates/trial-por-vencer";

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

/** URL absoluta del portal del paciente (CTA "Gestionar mi turno" de los emails). */
function portalUrl(): string {
  return `${getAppUrl()}/portal`;
}

/**
 * Email de contacto del consultorio para el Reply-To de los emails a
 * pacientes. La organization no tiene columna de email público, así que el
 * contacto de facto es el email del OWNER — el mismo buzón que recibe los
 * avisos de pedido nuevo (notifyPedidoNuevo), o sea el que el consultorio
 * efectivamente lee. Lecturas ANGOSTAS vía service client (profile tiene RLS
 * profile_select_self — mismo patrón que notifyPedidoNuevo). Fail-safe: ante
 * cualquier falla devuelve undefined y el email sale sin Reply-To (nunca
 * bloquea el envío).
 */
async function resolveOrgContactEmail(organizationId: string): Promise<string | undefined> {
  try {
    const service = createSupabaseServiceClient();
    const { data: owner } = await service
      .from("member")
      .select("profile_id")
      .eq("organization_id", organizationId)
      .eq("role", "OWNER")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const profileId = (owner?.profile_id as string | undefined) ?? null;
    if (!profileId) return undefined;

    const { data: profile } = await service
      .from("profile")
      .select("email")
      .eq("id", profileId)
      .maybeSingle();
    return (profile?.email as string | undefined) || undefined;
  } catch {
    return undefined;
  }
}

// ─── Confirmada: turno ya creado (auto-confirm o aceptarPedido) ────────────

export async function notifyBookingConfirmada(input: {
  client: ServerClient;
  turnoId: string;
  organizationId: string;
  pacienteEmail: string | null;
  pacienteNombre: string;
}): Promise<SendEmailResult> {
  const { client, turnoId, organizationId, pacienteEmail, pacienteNombre } = input;
  if (!pacienteEmail) return { status: "blocked", detail: "notification_context_unavailable" };

  try {
    const { data: org } = await client
      .from("organization")
      .select("nombre, timezone, direccion_completa, telefono_publico")
      .eq("id", organizationId)
      .maybeSingle();

    const { data: turno } = await client
      .from("turno")
      .select("inicio, duracion_min, servicio_id")
      .eq("id", turnoId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!turno) return { status: "blocked", detail: "notification_context_unavailable" };

    const fechaHoraLabel = formatFechaHora(turno.inicio, org?.timezone ?? null);
    const organizationNombre = org?.nombre ?? "Folio";
    const servicioNombre = "Turno";

    // Link "agregar a Google Calendar": turno confirmado → evento real.
    // DTEND = inicio + duración (fallback 30 min si la fila viniera rota).
    const gcalUrl = buildGoogleCalendarUrl({
      inicioIso: turno.inicio,
      finIso: addMinutesIso(turno.inicio, Number(turno.duracion_min) || 30),
      titulo: `${servicioNombre} · ${organizationNombre}`,
      ubicacion: org?.direccion_completa ?? null,
    });

    const { subject, html } = buildBookingConfirmadaEmail({
      pacienteNombre,
      organizationNombre,
      servicioNombre: "Turno",
      fechaHoraLabel,
      direccion: org?.direccion_completa ?? null,
      telefonoPublico: org?.telefono_publico ?? null,
      portalUrl: portalUrl(),
      gcalUrl,
    });

    // Reply-To consultorio: el interlocutor del paciente es el consultorio
    // (el from es un noreply). Sin contacto resoluble, sale sin Reply-To.
    const replyTo = await resolveOrgContactEmail(organizationId);
    return deliverDurableEmail({ organizationId, kind: "booking", dedupeKey: `booking-confirmed:${turnoId}:${turno.inicio}`, turnoId, expiresAt: turno.inicio, to: pacienteEmail, subject, html, replyTo });
  } catch {
    return { status: "failed", detail: "email_notification_preparation_failed", retryable: true };
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
  organizationId?: string;
  to: string;
  organizationNombre: string;
  rolLabel: string;
  invitadoPorNombre: string | null;
  acceptUrl: string;
  expiresAtIso: string;
  timezone: string | null;
}): Promise<SendEmailResult> {
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
    if (!input.organizationId) return { status: "blocked", detail: "organization_context_required" };
    return deliverDurableEmail({ organizationId: input.organizationId, kind: "invitation", dedupeKey: `invitation:${input.acceptUrl}`, expiresAt: input.expiresAtIso, to: input.to, subject, html, replyTo: SUPPORT_EMAIL });
  } catch {
    return { status: "failed", detail: "email_notification_preparation_failed", retryable: true };
  }
}

// ─── Recibida: pedido PENDIENTE (auto-confirm off o falló) ─────────────────

export async function notifyBookingRecibida(input: {
  client: ServerClient;
  pedidoId?: string;
  organizationId: string;
  pacienteEmail: string | null;
  pacienteNombre: string;
  servicioNombre: string;
  inicioIso: string;
}): Promise<SendEmailResult> {
  const { client, organizationId, pacienteEmail, pacienteNombre, servicioNombre, inicioIso } =
    input;
  if (!pacienteEmail) return { status: "blocked", detail: "notification_context_unavailable" };

  try {
    const { data: org } = await client
      .from("organization")
      .select("nombre, timezone, direccion_completa, telefono_publico")
      .eq("id", organizationId)
      .maybeSingle();

    const fechaHoraLabel = formatFechaHora(inicioIso, org?.timezone ?? null);

    const { subject, html } = buildBookingRecibidaEmail({
      pacienteNombre,
      organizationNombre: org?.nombre ?? "Folio",
      servicioNombre: "Turno",
      fechaHoraLabel,
      direccion: org?.direccion_completa ?? null,
      telefonoPublico: org?.telefono_publico ?? null,
      portalUrl: portalUrl(),
    });

    // Reply-To consultorio (mismo criterio que notifyBookingConfirmada).
    const replyTo = await resolveOrgContactEmail(organizationId);
    return deliverDurableEmail({ organizationId, kind: "booking", dedupeKey: input.pedidoId ? `booking-received:${input.pedidoId}` : `booking-received:${pacienteEmail}:${inicioIso}:${servicioNombre}`, expiresAt: inicioIso, to: pacienteEmail, subject, html, replyTo });
  } catch {
    return { status: "failed", detail: "email_notification_preparation_failed", retryable: true };
  }
}

/**
 * Le avisa al consultorio que un paciente canceló su turno desde el portal.
 *
 * Ninguna cancelación hecha por el paciente le avisaba al profesional: el hueco
 * se liberaba en silencio y él se enteraba cuando el paciente no aparecía —
 * habiendo perdido la chance de ofrecerle ese horario a otro.
 *
 * Fail-safe como el resto del módulo: NUNCA throwea. La cancelación del turno
 * ya ocurrió; un email caído no puede desandarla.
 */
export async function notifyTurnoCanceladoPorPaciente(input: {
  client: ServerClient;
  turnoId: string;
  organizationId: string;
  /** Reservado: hoy el aviso va al contacto de la org. */
  profesionalId?: string | null;
}): Promise<SendEmailResult> {
  const { client, turnoId, organizationId } = input;

  try {
    const destino = await resolveOrgContactEmail(organizationId);
    if (!destino) return { status: "blocked", detail: "notification_context_unavailable" };

    // El caller (cancelarTurnoPortal) no descifra nada: los datos del turno se
    // resuelven acá, que es donde se decide qué entra en el email.
    const { data: turno } = await client
      .from("turno_extendido")
      .select("inicio, servicio_nombre, paciente_nombre_cifrado")
      .eq("id", turnoId)
      .maybeSingle();
    if (!turno) return { status: "blocked", detail: "notification_context_unavailable" };

    const { data: org } = await client
      .from("organization")
      .select("nombre, timezone")
      .eq("id", organizationId)
      .maybeSingle();

    // El nombre está cifrado en la vista (M14): se descifra acá, server-side.
    // Si no se puede leer, el aviso sale igual sin nombre — que el profesional
    // se entere de la cancelación importa más que el detalle.
    const pacienteNombre =
      tryDecrypt(turno.paciente_nombre_cifrado as string | null, "turno.paciente_nombre") ??
      "Un paciente";
    const fechaHoraLabel = formatFechaHora(turno.inicio as string, org?.timezone ?? null);
    const servicio = "";

    return deliverDurableEmail({
      organizationId, kind: "booking_cancelled", dedupeKey: `booking-cancelled:${turnoId}`,
      to: destino,
      subject: `Turno cancelado: ${pacienteNombre} — ${fechaHoraLabel}`,
      html: `<p><b>${esc(pacienteNombre)}</b> canceló su turno del <b>${esc(fechaHoraLabel)}</b>${servicio} desde el portal.</p>
<p>El horario quedó libre en tu agenda.</p>
<p style="color:#666;font-size:13px">${esc(org?.nombre ?? "Folio")}</p>`,
    });
  } catch {
    return { status: "failed", detail: "email_notification_preparation_failed", retryable: true };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Ciclo de vida de suscripción (M65 · emails de billing al OWNER)
// ═════════════════════════════════════════════════════════════════════════════
//
// Mismo principio fail-safe que el resto del módulo: NUNCA throwean — el
// wiring (webhook MP / crones, PR posterior) las llama fire-and-forget y un
// email jamás rompe un cobro.
//
// Persistent encrypted envelopes replace the old reservation-before-send log.
// Legacy reservations stay unverified and are never blindly resent.

type BillingEmailTipo =
  | "trial_por_vencer"
  | "pago_fallido"
  | "suscripcion_suspendida"
  | "suscripcion_reactivada"
  | "suscripcion_cancelada_morosidad"
  | "suscripcion_activada";

/** URL absoluta de la pantalla de billing (CTA de todos los emails). */
function billingUrl(): string {
  return `${getAppUrl()}${BILLING_RECOVERY_PATH}`;
}

async function sendBillingLifecycleEmail(input: {
  organizationId: string;
  /** Email destino (payer_email del OWNER). */
  destinatario: string;
  tipo: BillingEmailTipo;
  dedupeKey: string;
  /** Contexto no sensible que queda en email_notificacion.meta. */
  meta?: Record<string, unknown>;
  /** Nombre de la notify* para tags de Sentry. */
  op: string;
  build: (ctx: { organizationNombre: string; billingUrl: string }) => {
    subject: string;
    html: string;
  };
}): Promise<SendEmailResult> {
  try {
    const service = createSupabaseServiceClient();

    // Regla 1: las orgs internas JAMÁS reciben emails de billing.
    const { data: org, error: orgErr } = await service
      .from("organization")
      .select("nombre, is_internal_account")
      .eq("id", input.organizationId)
      .maybeSingle();
    if (orgErr) {
      const { captureException } = await import("@sentry/nextjs");
      captureException(new Error("email_organization_lookup_failed"), {
        tags: { component: "email", op: input.op, step: "load_org" },
        extra: { organizationId: input.organizationId },
      });
      return { status: "blocked", detail: "notification_context_unavailable" };
    }
    if (!org || org.is_internal_account) return { status: "blocked", detail: "notification_context_unavailable" };

    const { subject, html } = input.build({
      organizationNombre: (org.nombre as string | null) ?? "tu consultorio",
      billingUrl: billingUrl(),
    });

    // Reply-To soporte: el destinatario es el OWNER (profesional); si responde
    // con dudas de facturación, debe llegar a Folio.
    return deliverDurableEmail({ organizationId: input.organizationId, kind: `billing_${input.tipo}`, dedupeKey: input.dedupeKey, legacyKey: input.dedupeKey, to: input.destinatario, subject, html, replyTo: SUPPORT_EMAIL });
  } catch {
    return { status: "failed", detail: "email_notification_preparation_failed", retryable: true };
  }
}

/**
 * Aviso "tu prueba termina en N días" (umbrales 7, 3 y 1 del grace de 30 días).
 * Dedupe por org + umbral: cada umbral se avisa una sola vez por org.
 */
export async function notifyTrialPorVencer(input: {
  organizationId: string;
  destinatario: string;
  diasRestantes: TrialUmbralDias;
  /** Precio mensual del plan de la org en centavos ARS. */
  montoMensualCents: number;
}): Promise<SendEmailResult> {
  return sendBillingLifecycleEmail({
    organizationId: input.organizationId,
    destinatario: input.destinatario,
    tipo: "trial_por_vencer",
    dedupeKey: `trial-por-vencer:${input.organizationId}:${input.diasRestantes}d`,
    meta: { dias_restantes: input.diasRestantes, monto_cents: input.montoMensualCents },
    op: "notifyTrialPorVencer",
    build: ({ organizationNombre, billingUrl }) =>
      buildTrialPorVencerEmail({
        organizationNombre,
        diasRestantes: input.diasRestantes,
        montoMensualCents: input.montoMensualCents,
        billingUrl,
      }),
  });
}

/**
 * Aviso de cobro rechazado. Dedupe por payment de MP: cada intento fallido
 * distinto avisa una vez; el webhook reenviado del mismo payment, nunca.
 */
export async function notifyPagoFallido(input: {
  organizationId: string;
  destinatario: string;
  /** mp_payment_id del cargo rechazado (cargo_suscripcion.mp_payment_id). */
  mpPaymentId: string;
  /** status_detail crudo de MP / suscripcion.ultimo_error. Se humaniza en el template. */
  ultimoError: string | null;
  montoCents: number;
}): Promise<SendEmailResult> {
  return sendBillingLifecycleEmail({
    organizationId: input.organizationId,
    destinatario: input.destinatario,
    tipo: "pago_fallido",
    dedupeKey: `pago-fallido:${input.organizationId}:${input.mpPaymentId}`,
    meta: { mp_payment_id: input.mpPaymentId, monto_cents: input.montoCents },
    op: "notifyPagoFallido",
    build: ({ organizationNombre, billingUrl }) =>
      buildPagoFallidoEmail({
        organizationNombre,
        montoCents: input.montoCents,
        ultimoError: input.ultimoError,
        billingUrl,
      }),
  });
}

/**
 * Aviso de suspensión (morosidad agotada, access gate bloqueado). Dedupe por
 * episodio de morosidad: `episodioIso` es el ISO de `suscripcion.morosa_desde`
 * (M65) — un episodio avisa una vez; un episodio nuevo vuelve a avisar.
 */
export async function notifySuscripcionSuspendida(input: {
  organizationId: string;
  destinatario: string;
  /** ISO de suscripcion.morosa_desde del episodio vigente. */
  episodioIso: string;
  montoMensualCents: number;
}): Promise<SendEmailResult> {
  return sendBillingLifecycleEmail({
    organizationId: input.organizationId,
    destinatario: input.destinatario,
    tipo: "suscripcion_suspendida",
    dedupeKey: `suscripcion-suspendida:${input.organizationId}:${input.episodioIso}`,
    meta: { episodio: input.episodioIso, monto_cents: input.montoMensualCents },
    op: "notifySuscripcionSuspendida",
    build: ({ organizationNombre, billingUrl }) =>
      buildSuscripcionSuspendidaEmail({
        organizationNombre,
        montoMensualCents: input.montoMensualCents,
        billingUrl,
      }),
  });
}

/**
 * Aviso de recuperación (cobro aprobado cerró el episodio MOROSA → ACTIVA).
 * Dedupe por el mismo `episodioIso` que abrió la morosidad.
 */
export async function notifySuscripcionReactivada(input: {
  organizationId: string;
  destinatario: string;
  /** ISO de suscripcion.morosa_desde del episodio que se cierra. */
  episodioIso: string;
  montoMensualCents: number;
}): Promise<SendEmailResult> {
  return sendBillingLifecycleEmail({
    organizationId: input.organizationId,
    destinatario: input.destinatario,
    tipo: "suscripcion_reactivada",
    dedupeKey: `suscripcion-reactivada:${input.organizationId}:${input.episodioIso}`,
    meta: { episodio: input.episodioIso, monto_cents: input.montoMensualCents },
    op: "notifySuscripcionReactivada",
    build: ({ organizationNombre, billingUrl }) =>
      buildSuscripcionReactivadaEmail({
        organizationNombre,
        montoMensualCents: input.montoMensualCents,
        billingUrl,
      }),
  });
}

/**
 * Aviso de cancelación por morosidad (estado terminal del episodio).
 * Dedupe por el mismo `episodioIso`.
 */
export async function notifySuscripcionCanceladaMorosidad(input: {
  organizationId: string;
  destinatario: string;
  /** ISO de suscripcion.morosa_desde del episodio que terminó en cancelación. */
  episodioIso: string;
  montoMensualCents: number;
}): Promise<SendEmailResult> {
  return sendBillingLifecycleEmail({
    organizationId: input.organizationId,
    destinatario: input.destinatario,
    tipo: "suscripcion_cancelada_morosidad",
    dedupeKey: `suscripcion-cancelada-morosidad:${input.organizationId}:${input.episodioIso}`,
    meta: { episodio: input.episodioIso, monto_cents: input.montoMensualCents },
    op: "notifySuscripcionCanceladaMorosidad",
    build: ({ organizationNombre, billingUrl }) =>
      buildSuscripcionCanceladaMorosidadEmail({
        organizationNombre,
        montoMensualCents: input.montoMensualCents,
        billingUrl,
      }),
  });
}

/**
 * Bienvenida al plan (primera vez que el preapproval queda ACTIVA). Dedupe
 * por mp_preapproval_id: una re-suscripción (preapproval nuevo) vuelve a dar
 * la bienvenida; un webhook `authorized` reenviado, no.
 */
export async function notifySuscripcionActivada(input: {
  organizationId: string;
  destinatario: string;
  /** suscripcion.mp_preapproval_id recién activado. */
  mpPreapprovalId: string;
  montoMensualCents: number;
}): Promise<SendEmailResult> {
  return sendBillingLifecycleEmail({
    organizationId: input.organizationId,
    destinatario: input.destinatario,
    tipo: "suscripcion_activada",
    dedupeKey: `suscripcion-activada:${input.organizationId}:${input.mpPreapprovalId}`,
    meta: { mp_preapproval_id: input.mpPreapprovalId, monto_cents: input.montoMensualCents },
    op: "notifySuscripcionActivada",
    build: ({ organizationNombre, billingUrl }) =>
      buildSuscripcionActivadaEmail({
        organizationNombre,
        montoMensualCents: input.montoMensualCents,
        billingUrl,
      }),
  });
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
}): Promise<SendEmailResult> {
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
    if (!profileId) return { status: "blocked", detail: "notification_context_unavailable" };

    // 2. Email del profile — lectura angosta vía service client (ver doc).
    const service = createSupabaseServiceClient();
    const { data: profile } = await service
      .from("profile")
      .select("email")
      .eq("id", profileId)
      .maybeSingle();
    const to = (profile?.email as string | undefined) ?? null;
    if (!to) return { status: "blocked", detail: "notification_context_unavailable" };

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
    return deliverDurableEmail({ organizationId, kind: "booking_request", dedupeKey: `pedido:${pedidoId}`, to, subject, html, replyTo: SUPPORT_EMAIL });
  } catch {
    return { status: "failed", detail: "email_notification_preparation_failed", retryable: true };
  }
}

"use server";

/**
 * Folio · Server Actions de /configuracion.
 *
 * Integraciones, datos del consultorio, servicios, horarios.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  countSesionesOtraEspecialidad,
  saveBookingPrefs,
  saveConsultorio,
  saveHorarios,
  saveServicios,
  type SaveBookingPrefsInput,
  type SaveConsultorioInput,
  type SaveHorariosInput,
  type SaveServiciosInput,
} from "@/lib/db/configuracion";
import {
  countSesionesOtraEspecialidadMember,
  createInvitation,
  removeMember,
  revokeInvitation,
  updateMemberEspecialidad,
  type CreateInvitationInput,
  type CreatedInvitation,
} from "@/lib/db/members";
import type { EspecialidadSlug } from "@/lib/especialidades/meta";
import { getActiveSession } from "@/lib/db/session";
import { err, ok, type Result } from "@/lib/db/errors";
import { roleLabel } from "@/lib/auth/capabilities";
import { decideUpgradeTipo } from "@/lib/billing/upgrade";
import {
  syncSubscriptionAmountInBackground,
  type EstadoSuscripcion,
} from "@/lib/db/suscripcion";
import { notifyMemberInvitation } from "@/lib/email/notify";
import { getAuthUrl as getGoogleAuthUrl } from "@/lib/google/oauth";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

/**
 * Revalida la página pública /book/<slug> de la org activa (ISR de 5 min en
 * app/(public)/book/[slug]/page.tsx). Path CONCRETO del slug — no el patrón
 * "/book/[slug]" — para no purgar el caché de todas las orgs en cada save.
 * Best-effort: si no podemos resolver el slug, el TTL de 300s igual refresca.
 */
async function revalidateBookPublico(): Promise<void> {
  try {
    const session = await getActiveSession();
    if (!session.ok) return;
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("organization")
      .select("slug")
      .eq("id", session.data.organizationId)
      .maybeSingle();
    if (data?.slug) revalidatePath(`/book/${data.slug}`);
  } catch {
    // best-effort — la página se regenera sola al expirar el revalidate.
  }
}

export async function saveConsultorioAction(input: SaveConsultorioInput): Promise<Result<void>> {
  const result = await saveConsultorio(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    revalidatePath("/", "layout");
    // Campos públicos (nombre, ciudad, tel, dirección, Instagram) viven en la
    // página estática /book/<slug> — refrescarla on-demand.
    await revalidateBookPublico();
  }
  return result;
}

export async function saveHorariosAction(input: SaveHorariosInput): Promise<Result<void>> {
  const result = await saveHorarios(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    await revalidateBookPublico();
  }
  return result;
}

export async function saveServiciosAction(input: SaveServiciosInput): Promise<Result<void>> {
  const result = await saveServicios(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    revalidatePath("/hoy");
    // Los servicios (nombre, duración, precio) se renderizan en la página
    // estática /book/<slug> — refrescarla on-demand.
    await revalidateBookPublico();
  }
  return result;
}

/**
 * M50 · count de sesiones con tool_id de OTRA especialidad. El client lo
 * llama al cambiar el selector de especialidad para mostrar la advertencia
 * de "los datos se conservan pero dejan de mostrarse" antes de guardar.
 */
export async function countSesionesOtraEspecialidadAction(
  nuevaEspecialidad: string,
): Promise<Result<number>> {
  return countSesionesOtraEspecialidad(nuevaEspecialidad);
}

export async function saveBookingPrefsAction(input: SaveBookingPrefsInput): Promise<Result<void>> {
  const result = await saveBookingPrefs(input);
  if (result.ok) {
    revalidatePath("/configuracion");
  }
  return result;
}

// ─── Equipo (M49/M51 · Fase C) ──────────────────────────────────────────────

export interface InviteMemberResult {
  invitation: CreatedInvitation["invitation"];
  /** Link con el token crudo — solo se muestra una vez para copiar. */
  acceptUrl: string;
  /** false cuando RESEND_API_KEY no está configurada (envío simulado). */
  emailEnviado: boolean;
}

export async function inviteMemberAction(
  input: CreateInvitationInput,
): Promise<Result<InviteMemberResult>> {
  const result = await createInvitation(input);
  if (!result.ok) return result;

  // Email fail-safe (lib/email): si no sale, la invitación NO se pierde — la
  // UI muestra acceptUrl para copiar. Nunca loguear acceptUrl (token crudo).
  const emailEnviado = Boolean(process.env.RESEND_API_KEY);
  await notifyMemberInvitation({
    to: result.data.invitation.email,
    organizationNombre: result.data.organizationNombre,
    rolLabel: roleLabel(result.data.invitation.role, result.data.invitation.esColegiado),
    invitadoPorNombre: result.data.invitedByNombre,
    acceptUrl: result.data.acceptUrl,
    expiresAtIso: result.data.expiresAtIso,
    timezone: result.data.organizationTimezone,
  });

  revalidatePath("/configuracion");
  return {
    ok: true,
    data: {
      invitation: result.data.invitation,
      acceptUrl: result.data.acceptUrl,
      emailEnviado,
    },
  };
}

export async function revokeInvitationAction(invitationId: string): Promise<Result<void>> {
  const result = await revokeInvitation(invitationId);
  if (result.ok) revalidatePath("/configuracion");
  return result;
}

export async function removeMemberAction(memberId: string): Promise<Result<void>> {
  const result = await removeMember(memberId);
  if (result.ok) revalidatePath("/configuracion");
  return result;
}

/**
 * M55 · setea/borra la especialidad propia de un member colegiado
 * (null = vuelve a heredar organization.especialidad). El gate real es
 * server-side en lib/db/members.ts: solo orgs CLINICA (en INDEPENDIENTE la
 * especialidad vive a nivel organización), canManageTeam O el propio member,
 * slug validado contra el registry, audit log del cambio.
 */
export async function updateMemberEspecialidadAction(
  memberId: string,
  especialidad: EspecialidadSlug | null,
): Promise<Result<void>> {
  const result = await updateMemberEspecialidad(memberId, especialidad);
  if (result.ok) {
    revalidatePath("/configuracion");
    // La ficha deriva la herramienta del profesional del turno activo.
    revalidatePath("/pacientes", "layout");
  }
  return result;
}

/**
 * M55 · espejo per-member de countSesionesOtraEspecialidadAction: cuántas
 * sesiones de turnos de este profesional quedaron con OTRA herramienta. La UI
 * lo consulta antes de confirmar el cambio de especialidad del member.
 */
export async function countSesionesOtraEspecialidadMemberAction(
  memberId: string,
  nuevaEspecialidad: EspecialidadSlug | null,
): Promise<Result<number>> {
  return countSesionesOtraEspecialidadMember(memberId, nuevaEspecialidad);
}

// ─── Upgrade de tier (PR 1.4 · self-serve a Clínica, sin proration) ─────────

export interface UpgradeOrgTipoResult {
  /** Monto mensual (centavos ARS) antes del cambio, según pricing.ts. */
  montoAntesCents: number;
  /** Monto mensual (centavos ARS) después (CLINICA con seats actuales). */
  montoDespuesCents: number;
}

/**
 * PR 1.4 · pasa la org de INDEPENDIENTE a CLINICA (upgrade self-serve, SIN
 * proration). El monto nuevo aplica al PRÓXIMO débito del preapproval — no hay
 * cargo retroactivo.
 *
 * Guard: solo el OWNER (patrón removeMember, lib/db/members.ts). La validación
 * de negocio (tipo/rol/downgrade) vive en la decisión pura `decideUpgradeTipo`.
 * Defense-in-depth: la policy org_update_owner (M02) también exige OWNER, así
 * que un no-OWNER que saltee el guard afectaría 0 filas en el UPDATE.
 *
 * Orden de persistencia (ver plan): primero el estado + el registro de
 * auditoría, DESPUÉS el sync del monto — el PUT de MP es idempotente y el cron
 * reconcile repara si el sync falla, así que nunca bloqueamos el flujo por él.
 *
 *   1. UPDATE organization.tipo = 'CLINICA' (server client, RLS-aware: la
 *      policy org_update_owner de M02 exige OWNER — el guard de arriba ya lo
 *      restringió).
 *   2. INSERT en organization_tipo_cambio con SERVICE client — M66 no tiene
 *      policy de INSERT (solo service_role escribe). Es el audit trail
 *      append-only del cambio de plan (quién, cuándo, impacto de precio).
 *   3. syncSubscriptionAmountInBackground(org, 'upgrade_tipo') fire-and-forget:
 *      ajusta el preapproval al monto de Clínica si la suscripción está
 *      ACTIVA/MOROSA; en cualquier otro estado es un skip inocuo (el próximo
 *      alta/reactivación toma el monto del tier actual).
 */
export async function upgradeOrgTipoAction(): Promise<Result<UpgradeOrgTipoResult>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  // Guard duro de rol (defense-in-depth con la policy organization_update):
  // solo el OWNER paga y cambia el plan.
  if (session.data.role !== "OWNER") {
    return err("forbidden", "Solo el titular de la cuenta puede cambiar el plan.");
  }

  const supabase = await createSupabaseServerClient();

  // Snapshot del estado actual: tipo + seats activos + estado de suscripción.
  const { data: orgRow, error: orgErr } = await supabase
    .from("organization")
    .select("id, tipo")
    .eq("id", session.data.organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (orgErr) return err("db_error", "Error leyendo la organización.", orgErr.message);
  if (!orgRow) return err("not_found", "Organización no encontrada.");
  const tipoActual = (orgRow as { tipo: "INDEPENDIENTE" | "CLINICA" }).tipo;

  // Head-count de members activos (incluye al OWNER) — define los seats que
  // cobra Clínica. `head: true` no trae filas, solo el count.
  const { count: membersCount, error: cntErr } = await supabase
    .from("member")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", session.data.organizationId)
    .is("deleted_at", null);
  if (cntErr) return err("db_error", "Error contando miembros activos.", cntErr.message);
  const membersActivos = membersCount ?? 1;

  const { data: subRow, error: subErr } = await supabase
    .from("suscripcion")
    .select("estado")
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();
  if (subErr) return err("db_error", "Error leyendo la suscripción.", subErr.message);
  const estadoSuscripcion =
    (subRow as { estado: EstadoSuscripcion } | null)?.estado ?? null;

  const decision = decideUpgradeTipo({
    tipoActual,
    rol: session.data.role,
    membersActivos,
    estadoSuscripcion,
  });
  if (!decision.elegible) {
    return err("conflict", decision.motivo ?? "El plan no se puede cambiar desde acá.");
  }

  // 1. Persistir el tipo. RLS-aware (server client): la policy org_update_owner
  // (M02) exige OWNER — el guard de arriba ya lo restringió.
  const { data: updated, error: updErr } = await supabase
    .from("organization")
    .update({ tipo: "CLINICA" })
    .eq("id", session.data.organizationId)
    .eq("tipo", "INDEPENDIENTE") // guard optimista contra doble-click / carrera
    .is("deleted_at", null)
    .select("id");
  if (updErr) return err("db_error", "No se pudo cambiar el plan.", updErr.message);
  if (!updated || updated.length === 0) {
    // 0 filas: o ya era CLINICA (carrera) o la policy bloqueó el UPDATE.
    return err("conflict", "El plan ya está actualizado o no tenés permiso para cambiarlo.");
  }

  // 2. Audit trail append-only (M66). SERVICE client obligatorio: la tabla no
  // tiene policy de INSERT, solo service_role (BYPASSRLS) escribe. changed_by
  // = auth.users.id del actor (= profile.id = session.userId en Folio).
  const service = createSupabaseServiceClient();
  const { error: cambioErr } = await service.from("organization_tipo_cambio").insert({
    organization_id: session.data.organizationId,
    de_tipo: "INDEPENDIENTE",
    a_tipo: "CLINICA",
    changed_by: session.data.userId,
    monto_antes_cents: decision.montoAntes,
    monto_despues_cents: decision.montoDespues,
  });
  if (cambioErr) {
    // El tipo ya se cambió (paso 1). No revertimos: el cambio de plan es válido
    // y el registro de auditoría es best-effort — logueamos para reconciliar a
    // mano si hiciera falta, pero no le fallamos al usuario un upgrade que ya
    // ocurrió. (Sin PII: solo ids internos y montos.)
    console.warn(
      `[billing] upgrade_tipo org=${session.data.organizationId}: INSERT organization_tipo_cambio falló: ${cambioErr.message}`,
    );
  }

  // 3. Sync del monto — fire-and-forget, JAMÁS bloquea el upgrade. El PUT a MP
  // es idempotente y el cron reconcile repara divergencias.
  syncSubscriptionAmountInBackground(session.data.organizationId, "upgrade_tipo");

  revalidatePath("/configuracion");
  revalidatePath("/", "layout");

  return ok({
    montoAntesCents: decision.montoAntes,
    montoDespuesCents: decision.montoDespues,
  });
}

export async function connectGoogleCalendar(): Promise<Result<void>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  // CRITICAL: redirect() de next/navigation funciona vía throw interno
  // (NEXT_REDIRECT). Si se ejecuta dentro de un try/catch, el catch lo
  // intercepta y el redirect nunca sucede. Por eso construimos la URL
  // dentro del try (puede fallar si faltan envs) pero `redirect(url)`
  // queda FUERA del try/catch.
  //
  // Si `getGoogleAuthUrl` tira (envs missing en runtime), el catch
  // devuelve un Result.err amigable. Si la URL se construye OK,
  // redirect() hace su throw normal y Next navega al consent de Google.
  let url: string;
  try {
    url = getGoogleAuthUrl(session.data.memberId);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err(
      "validation",
      "Google Calendar no está configurado. Avisanos para activarlo.",
      detail,
    );
  }
  redirect(url);
}

export async function disconnectGoogleCalendar(): Promise<Result<void>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("integration")
    .delete()
    .eq("organization_id", session.data.organizationId)
    .eq("profesional_id", session.data.memberId)
    .eq("proveedor", "GOOGLE_CALENDAR");

  if (error) {
    return err("db_error", "Error desconectando Google Calendar.", error.message);
  }
  revalidatePath("/configuracion");
  return { ok: true, data: undefined };
}

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
import { err, type Result } from "@/lib/db/errors";
import { roleLabel } from "@/lib/auth/capabilities";
import { notifyMemberInvitation } from "@/lib/email/notify";
import { getAuthUrl as getGoogleAuthUrl } from "@/lib/google/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

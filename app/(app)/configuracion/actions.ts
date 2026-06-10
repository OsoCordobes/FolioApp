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
  createInvitation,
  removeMember,
  revokeInvitation,
  type CreateInvitationInput,
  type CreatedInvitation,
} from "@/lib/db/members";
import { getActiveSession } from "@/lib/db/session";
import { err, type Result } from "@/lib/db/errors";
import { roleLabel } from "@/lib/auth/capabilities";
import { notifyMemberInvitation } from "@/lib/email/notify";
import { getAuthUrl as getGoogleAuthUrl } from "@/lib/google/oauth";

export async function saveConsultorioAction(input: SaveConsultorioInput): Promise<Result<void>> {
  const result = await saveConsultorio(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    revalidatePath("/", "layout");
  }
  return result;
}

export async function saveHorariosAction(input: SaveHorariosInput): Promise<Result<void>> {
  const result = await saveHorarios(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    revalidatePath("/book/[slug]", "page");
  }
  return result;
}

export async function saveServiciosAction(input: SaveServiciosInput): Promise<Result<void>> {
  const result = await saveServicios(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    revalidatePath("/book/[slug]", "page");
    revalidatePath("/hoy");
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

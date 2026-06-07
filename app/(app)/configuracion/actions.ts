"use server";

/**
 * Folio · Server Actions de /configuracion.
 *
 * Integraciones, datos del consultorio, servicios, horarios.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  saveBookingPrefs,
  saveConsultorio,
  saveHorarios,
  saveServicios,
  type SaveBookingPrefsInput,
  type SaveConsultorioInput,
  type SaveHorariosInput,
  type SaveServiciosInput,
} from "@/lib/db/configuracion";
import { getActiveSession } from "@/lib/db/session";
import { err, type Result } from "@/lib/db/errors";
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

export async function saveBookingPrefsAction(input: SaveBookingPrefsInput): Promise<Result<void>> {
  const result = await saveBookingPrefs(input);
  if (result.ok) {
    revalidatePath("/configuracion");
  }
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

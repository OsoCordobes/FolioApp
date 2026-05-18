"use server";

/**
 * Folio · Server Actions de /configuracion.
 *
 * Integraciones, datos del consultorio, servicios, horarios.
 */

import { redirect } from "next/navigation";

import { getActiveSession } from "@/lib/db/session";
import { err, type Result } from "@/lib/db/errors";
import { getAuthUrl as getGoogleAuthUrl } from "@/lib/google/oauth";

export async function connectGoogleCalendar(): Promise<Result<void>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  try {
    const url = getGoogleAuthUrl(session.data.memberId);
    redirect(url);
  } catch (e) {
    return err(
      "validation",
      "Google Calendar no está configurado. Setear GOOGLE_OAUTH_CLIENT_ID en .env.local.",
      e instanceof Error ? e.message : String(e),
    );
  }
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
  return { ok: true, data: undefined };
}

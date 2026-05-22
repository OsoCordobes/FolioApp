"use server";

/**
 * Folio · Server Actions de /configuracion.
 *
 * Integraciones, datos del consultorio, servicios, horarios, ARCO
 * (Ley 25.326 art. 14-16): supresión de cuenta vía pseudonimización.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { saveConsultorio, type SaveConsultorioInput } from "@/lib/db/configuracion";
import { getActiveSession } from "@/lib/db/session";
import { err, ok, type Result } from "@/lib/db/errors";
import { getAuthUrl as getGoogleAuthUrl } from "@/lib/google/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function saveConsultorioAction(input: SaveConsultorioInput): Promise<Result<void>> {
  const result = await saveConsultorio(input);
  if (result.ok) {
    revalidatePath("/configuracion");
    revalidatePath("/", "layout");
  }
  return result;
}

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

// ─── ARCO art. 16 · supresión de cuenta del profesional ─────────────────────

const eliminarCuentaInput = z.object({
  motivo: z
    .string()
    .min(20, "El motivo debe tener al menos 20 caracteres (Ley 25.326 art. 16).")
    .max(500),
  emailConfirmacion: z.string().email(),
});

/**
 * Pseudonimiza el profile del usuario autenticado:
 *  - PII en `profile.*_cifrado` reemplazada por placeholder, email anulado.
 *  - Memberships soft-deleted.
 *  - Datos clínicos huérfanos retenidos 10 años (Ley 26.529 art. 18).
 *  - Audit log explícito en cada org donde el profile fue miembro.
 *
 * Tras éxito, cierra la sesión Supabase (forzando logout en el browser).
 * El UI (Session B) se encarga del redirect al /login.
 *
 * Idempotencia: si la cuenta ya fue pseudonimizada, retorna ok(undefined).
 */
export async function eliminarCuentaAction(
  input: z.infer<typeof eliminarCuentaInput>,
): Promise<Result<void>> {
  const parsed = eliminarCuentaInput.safeParse(input);
  if (!parsed.success) {
    return err("validation", parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const session = await getActiveSession();
  if (!session.ok) return session;

  if (parsed.data.emailConfirmacion.toLowerCase() !== session.data.email.toLowerCase()) {
    return err("validation", "El email de confirmación no coincide con el de tu cuenta.");
  }

  const supabase = await createSupabaseServerClient();

  // pseudonimizar_member ejecuta con SECURITY DEFINER y usa auth.uid()
  // para identificar el profile; no acepta parámetro de profile_id, lo
  // cual previene que un OWNER elimine la cuenta de otro miembro por
  // accidente o malicia.
  const { error: rpcErr } = await supabase.rpc("pseudonimizar_member", {
    p_motivo: parsed.data.motivo,
    p_dry_run: false,
  });

  if (rpcErr) {
    return err(
      "db_error",
      "No se pudo eliminar la cuenta. Contactá a privacidad@folio.app.",
      rpcErr.message,
    );
  }

  // Cerrar sesión del browser. Tras esto el cliente debe redirigir a /login.
  await supabase.auth.signOut();

  return ok(undefined);
}

/**
 * Versión "dry run" para mostrar al usuario antes de confirmar qué se va
 * a hacer. Devuelve un JSON con cantidades de memberships afectadas.
 */
export async function previewEliminarCuentaAction(): Promise<
  Result<{ memberships: number }>
> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error: rpcErr } = await supabase.rpc("pseudonimizar_member", {
    p_motivo: "DRY_RUN — preview de impacto antes de eliminar cuenta del titular.",
    p_dry_run: true,
  });

  if (rpcErr) {
    return err("db_error", "No se pudo calcular el impacto.", rpcErr.message);
  }

  const memberships = Array.isArray(
    (data as { memberships?: unknown })?.memberships,
  )
    ? (data as { memberships: unknown[] }).memberships.length
    : 0;

  return ok({ memberships });
}

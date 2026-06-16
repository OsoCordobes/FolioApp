"use server";

/**
 * Folio · Server Action de Configuración → Presencia online → Directorio (M64).
 *
 * Toggle de `organization.listar_en_directorio` (opt-IN al directorio público
 * /profesionales). Modelado en privacidad-actions.ts. Consentimiento Ley 25.326
 * superior al link de reserva: al activar se sella listar_en_directorio_at.
 *
 * Permisos: OWNER o DIRECTOR (la RLS de organization ya lo enforce en DB; este
 * check es defensa en profundidad con mensaje claro). revalida /configuracion y
 * /profesionales para que el alta/baja se refleje sin esperar al ISR.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const setListarInput = z.object({ listar: z.boolean() });

export async function setListarEnDirectorioAction(
  input: z.infer<typeof setListarInput>,
): Promise<Result<{ listar: boolean }>> {
  const parsed = setListarInput.safeParse(input);
  if (!parsed.success) return err("validation", "Parámetros inválidos.");

  const session = await getActiveSession();
  if (!session.ok) return session;
  if (session.data.role !== "OWNER" && session.data.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER o DIRECTOR puede cambiar este ajuste.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organization")
    .update({
      listar_en_directorio: parsed.data.listar,
      listar_en_directorio_at: parsed.data.listar ? new Date().toISOString() : null,
    })
    .eq("id", session.data.organizationId);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  revalidatePath("/configuracion");
  revalidatePath("/profesionales");
  return ok({ listar: parsed.data.listar });
}

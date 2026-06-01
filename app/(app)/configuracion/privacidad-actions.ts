"use server";

/**
 * Folio · Server Actions de Configuración → Privacidad.
 *
 * Vive en archivo aparte de `actions.ts` (propiedad de Session A en el
 * handoff de compliance 2026-05-21) para evitar pisar a la otra sesión.
 * Contrato consumido por components/configuracion/configuracion.tsx
 * (sección "Privacidad", agregada en C3 del handoff).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveSession } from "@/lib/db/session";
import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const setOptOutInput = z.object({
  optOut: z.boolean(),
});

/**
 * Toggle de `organization.opt_out_analytics`. Cuando está en true, el pipeline
 * de analytics agregadas (k-anónimo) ignora a esta organización por completo.
 *
 * Permisos: OWNER o DIRECTOR (consistente con resto de saves de la org). RLS
 * de la tabla `organization` ya enforce esto en DB; este check es defensa en
 * profundidad para devolver un mensaje claro en vez de un error de RLS.
 */
export async function setOptOutAnalyticsAction(
  input: z.infer<typeof setOptOutInput>,
): Promise<Result<{ optOut: boolean }>> {
  const parsed = setOptOutInput.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Parámetros inválidos.");
  }

  const session = await getActiveSession();
  if (!session.ok) return session;
  if (session.data.role !== "OWNER" && session.data.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER o DIRECTOR puede cambiar este ajuste.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organization")
    .update({ opt_out_analytics: parsed.data.optOut })
    .eq("id", session.data.organizationId);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  revalidatePath("/configuracion");
  return ok({ optOut: parsed.data.optOut });
}

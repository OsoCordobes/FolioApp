"use server";

/**
 * Folio · Server Action para validar disponibilidad del slug en real-time.
 *
 * Llamada desde <SlugEditor /> con debounce 400ms en cada keystroke.
 * Bypassea RLS (service client) porque consulta TODAS las orgs, no solo
 * las del user actual — un slug puede estar tomado por otra org y el user
 * tiene que saberlo aunque no la pueda ver.
 *
 * Performance: query a un índice UNIQUE → ~5ms p99. Sin paginación, sin
 * scan completo.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { suggestSlugAlternatives, validateSlugFormat } from "./slug";

export type SlugCheckResult =
  | { ok: true; available: true; slug: string }
  | { ok: true; available: false; slug: string; suggestions: string[] }
  | { ok: false; error: string };

/**
 * Verifica si un slug está disponible para una nueva org.
 *
 * `currentOrgId` opcional: cuando un user en onboarding ya tiene su org
 * creada (post-M20 architecture) y quiere mantener su mismo slug, no
 * debemos marcarlo como "tomado". Pasamos su orgId para excluirla del check.
 */
export async function checkSlugAvailability(
  slug: string,
  currentOrgId?: string,
): Promise<SlugCheckResult> {
  // Validación de formato primero (no gasta query a DB si falla).
  const formatErr = validateSlugFormat(slug);
  if (formatErr) return { ok: false, error: formatErr };

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("organization")
    .select("id")
    .eq("slug", slug)
    .is("deleted_at", null);

  if (currentOrgId) {
    query = query.neq("id", currentOrgId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return { ok: false, error: "Error verificando disponibilidad." };
  }

  if (!data) {
    return { ok: true, available: true, slug };
  }

  return {
    ok: true,
    available: false,
    slug,
    suggestions: suggestSlugAlternatives(slug),
  };
}
